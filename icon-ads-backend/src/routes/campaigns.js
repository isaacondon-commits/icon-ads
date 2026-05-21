const router = require('express').Router();
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../lib/auditLog');
const { bumpPlaylistsForCampaignId } = require('../lib/bumpPlaylists');

router.use(requireAuth);

const campaignSchema = z.object({
  clientId: z.number().int().positive(),
  name: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  cpm: z.number().positive().nullable().optional(),
  maxImpressions: z.number().int().positive().nullable().optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { deletedAt: null },
      include: {
        client: { select: { id: true, name: true } },
        _count: { select: { metrics: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(campaigns);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { clientId, name, startDate, endDate, cpm, maxImpressions } = campaignSchema.parse(req.body);
    const campaign = await prisma.campaign.create({
      data: { clientId, name, startDate: new Date(startDate), endDate: new Date(endDate), cpm: cpm ?? null, maxImpressions: maxImpressions ?? null },
      include: { client: { select: { id: true, name: true } } },
    });
    await audit(req, 'CREATE', 'campaign', campaign.id, `Created "${campaign.name}"`);
    res.status(201).json(campaign);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// GET /:id — with ads, metrics summary, comments (#8, #18)
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [campaign, playsPerDay, comments] = await Promise.all([
      prisma.campaign.findUnique({
        where: { id, deletedAt: null },
        include: {
          client: { select: { id: true, name: true } },
          ads: { where: { deletedAt: null } },
          _count: { select: { metrics: true } },
        },
      }),
      prisma.$queryRaw`
        SELECT DATE(played_at AT TIME ZONE 'UTC') AS date, COUNT(*)::int AS count
        FROM metrics WHERE campaign_id = ${id}
        GROUP BY DATE(played_at AT TIME ZONE 'UTC')
        ORDER BY date DESC LIMIT 30
      `,
      prisma.comment.findMany({
        where: { campaignId: id },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ ...campaign, playsPerDay, comments });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const body = campaignSchema.partial().parse(req.body);
    const data = { ...body };
    if (body.startDate) data.startDate = new Date(body.startDate);
    if (body.endDate) data.endDate = new Date(body.endDate);
    const campaign = await prisma.campaign.update({ where: { id: Number(req.params.id), deletedAt: null }, data });
    await audit(req, 'UPDATE', 'campaign', campaign.id, `Updated "${campaign.name}"`);
    res.json(campaign);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Campaign not found' });
    next(err);
  }
});

// DELETE — soft delete (#33)
router.delete('/:id', async (req, res, next) => {
  try {
    const campaign = await prisma.campaign.update({
      where: { id: Number(req.params.id), deletedAt: null },
      data: { active: false, deletedAt: new Date() },
    });
    await audit(req, 'DELETE', 'campaign', campaign.id, `Deleted "${campaign.name}"`);
    await bumpPlaylistsForCampaignId(campaign.id);
    res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Campaign not found' });
    next(err);
  }
});

// PATCH /:id/reactivate (#34)
router.patch('/:id/reactivate', async (req, res, next) => {
  try {
    const campaign = await prisma.campaign.update({ where: { id: Number(req.params.id) }, data: { active: true, deletedAt: null } });
    await audit(req, 'REACTIVATE', 'campaign', campaign.id, `Reactivated "${campaign.name}"`);
    res.json(campaign);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Campaign not found' });
    next(err);
  }
});

// PATCH /:id/pause — pause campaign (#15)
router.patch('/:id/pause', async (req, res, next) => {
  try {
    const campaign = await prisma.campaign.update({ where: { id: Number(req.params.id) }, data: { active: false } });
    await audit(req, 'PAUSE', 'campaign', campaign.id, `Paused "${campaign.name}"`);
    await bumpPlaylistsForCampaignId(campaign.id);
    res.json(campaign);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Campaign not found' });
    next(err);
  }
});

// PATCH /:id/resume — resume campaign (#15) + validate has approved ads (#25)
router.patch('/:id/resume', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const approvedAds = await prisma.ad.count({
      where: { campaignId: id, active: true, deletedAt: null, approvalStatus: 'approved' },
    });
    if (approvedAds === 0) {
      return res.status(400).json({ error: 'La campaña no tiene anuncios aprobados. Agregá al menos un anuncio antes de activarla.' });
    }
    const campaign = await prisma.campaign.update({ where: { id }, data: { active: true } });
    await audit(req, 'RESUME', 'campaign', campaign.id, `Resumed "${campaign.name}"`);
    res.json(campaign);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Campaign not found' });
    next(err);
  }
});

// POST /:id/clone — clone campaign with all its ads (#9)
router.post('/:id/clone', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const original = await prisma.campaign.findUnique({
      where: { id, deletedAt: null },
      include: { ads: { where: { deletedAt: null, active: true } } },
    });
    if (!original) return res.status(404).json({ error: 'Campaign not found' });
    const clone = await prisma.campaign.create({
      data: {
        clientId: original.clientId,
        name: `${original.name} (copia)`,
        startDate: original.startDate,
        endDate: original.endDate,
        cpm: original.cpm,
        maxImpressions: original.maxImpressions,
        active: false,
        ads: {
          create: original.ads.map((ad) => ({
            name: ad.name,
            type: ad.type,
            fileUrl: ad.fileUrl,
            filename: ad.filename,
            durationS: ad.durationS,
            active: ad.active,
            approvalStatus: ad.approvalStatus,
            priority: ad.priority,
            targetUrl: ad.targetUrl ?? null,
            startsAt: ad.startsAt ?? null,
            endsAt: ad.endsAt ?? null,
          })),
        },
      },
      include: { client: { select: { id: true, name: true } }, _count: { select: { metrics: true } } },
    });
    await audit(req, 'CLONE', 'campaign', clone.id, `Clonada de campaña #${id} "${original.name}"`);
    res.status(201).json(clone);
  } catch (err) {
    next(err);
  }
});

// POST /:id/comments — add comment (#18)
router.post('/:id/comments', async (req, res, next) => {
  try {
    const { body } = z.object({ body: z.string().min(1) }).parse(req.body);
    const comment = await prisma.comment.create({
      data: {
        campaignId: Number(req.params.id),
        userId: req.user?.id ?? null,
        authorName: req.user?.name ?? 'Admin',
        body,
      },
    });
    res.status(201).json(comment);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

module.exports = router;
