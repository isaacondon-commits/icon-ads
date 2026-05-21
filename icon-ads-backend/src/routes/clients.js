const router = require('express').Router();
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { audit } = require('../lib/auditLog');

router.use(requireAuth);

const clientSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  company: z.string().optional(),
  rut: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const clients = await prisma.client.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    res.json(clients);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const data = clientSchema.parse(req.body);
    const client = await prisma.client.create({ data });
    await audit(req, 'CREATE', 'client', client.id, `Created "${client.name}"`);
    res.status(201).json(client);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// GET /:id — full profile with campaigns + metrics aggregate (#8)
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [client, campaigns, metricsAgg] = await Promise.all([
      prisma.client.findUnique({ where: { id, deletedAt: null } }),
      prisma.campaign.findMany({
        where: { clientId: id, deletedAt: null },
        include: { ads: { where: { deletedAt: null } }, _count: { select: { metrics: true } } },
        orderBy: { startDate: 'desc' },
      }),
      prisma.metric.groupBy({
        by: ['campaignId'],
        where: { campaign: { clientId: id } },
        _count: { id: true },
        _sum: { durationPlayedS: true },
      }),
    ]);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const aggMap = Object.fromEntries(
      metricsAgg.map((r) => [r.campaignId, { plays: r._count.id, totalSeconds: r._sum.durationPlayedS ?? 0 }])
    );
    const campaignsWithStats = campaigns.map((c) => ({ ...c, stats: aggMap[c.id] ?? { plays: 0, totalSeconds: 0 } }));
    res.json({ ...client, campaigns: campaignsWithStats });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const data = clientSchema.partial().parse(req.body);
    const client = await prisma.client.update({ where: { id: Number(req.params.id), deletedAt: null }, data });
    await audit(req, 'UPDATE', 'client', client.id, `Updated "${client.name}"`);
    res.json(client);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Client not found' });
    next(err);
  }
});

// DELETE — soft delete (#33)
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const client = await prisma.client.update({
      where: { id: Number(req.params.id), deletedAt: null },
      data: { active: false, deletedAt: new Date() },
    });
    await audit(req, 'DELETE', 'client', client.id, `Deleted "${client.name}"`);
    res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Client not found' });
    next(err);
  }
});

// PATCH /:id/reactivate (#34)
router.patch('/:id/reactivate', requireAdmin, async (req, res, next) => {
  try {
    const client = await prisma.client.update({ where: { id: Number(req.params.id) }, data: { active: true, deletedAt: null } });
    await audit(req, 'REACTIVATE', 'client', client.id, `Reactivated "${client.name}"`);
    res.json(client);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Client not found' });
    next(err);
  }
});

module.exports = router;
