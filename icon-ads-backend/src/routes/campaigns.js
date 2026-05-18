const router = require('express').Router();
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../lib/auditLog');

router.use(requireAuth);

const campaignSchema = z.object({
  clientId: z.number().int().positive(),
  name: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

router.get('/', async (req, res, next) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { deletedAt: null },
      include: { client: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(campaigns);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { clientId, name, startDate, endDate } = campaignSchema.parse(req.body);
    const campaign = await prisma.campaign.create({
      data: { clientId, name, startDate: new Date(startDate), endDate: new Date(endDate) },
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
    res.json(campaign);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Campaign not found' });
    next(err);
  }
});

// PATCH /:id/resume — resume campaign (#15)
router.patch('/:id/resume', async (req, res, next) => {
  try {
    const campaign = await prisma.campaign.update({ where: { id: Number(req.params.id) }, data: { active: true } });
    await audit(req, 'RESUME', 'campaign', campaign.id, `Resumed "${campaign.name}"`);
    res.json(campaign);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Campaign not found' });
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
