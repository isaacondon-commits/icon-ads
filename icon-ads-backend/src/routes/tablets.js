const router = require('express').Router();
const { z } = require('zod');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const forceSyncFlags = require('../lib/forceSyncFlags');

router.use(requireAuth);

const tabletSchema = z.object({
  deviceId: z.string().min(1),
  name: z.string().min(1),
  zone: z.string().optional(),
  playlistId: z.number().int().positive().nullable().optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const tablets = await prisma.tablet.findMany({
      include: { playlist: { select: { id: true, name: true, version: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(tablets);
  } catch (err) {
    next(err);
  }
});

// GET /api/tablets/monitor — live stats per tablet (polls every 15s from frontend)
router.get('/monitor', async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [tablets, playCounts] = await Promise.all([
      prisma.tablet.findMany({
        include: { playlist: { select: { id: true, name: true } } },
        orderBy: { name: 'asc' },
      }),
      prisma.metric.groupBy({
        by: ['tabletId'],
        where: { playedAt: { gte: today } },
        _count: { id: true },
      }),
    ]);

    const countMap = Object.fromEntries(playCounts.map((r) => [r.tabletId, r._count.id]));
    const now = Date.now();

    const result = tablets.map((t) => {
      const diffMin = t.lastSync ? (now - new Date(t.lastSync).getTime()) / 60000 : Infinity;
      const liveStatus = diffMin < 70 ? 'online' : 'offline';
      return {
        id: t.id,
        name: t.name,
        deviceId: t.deviceId,
        zone: t.zone,
        status: liveStatus,
        lastSync: t.lastSync,
        playlist: t.playlist ? { id: t.playlist.id, name: t.playlist.name } : null,
        todayPlays: countMap[t.id] ?? 0,
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { deviceId, name, zone, playlistId } = tabletSchema.parse(req.body);
    const token = crypto.randomBytes(32).toString('hex');
    const tablet = await prisma.tablet.create({
      data: { deviceId, name, zone, playlistId, token },
    });
    res.status(201).json(tablet);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.code === 'P2002') return res.status(409).json({ error: 'Device ID already registered' });
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const tablet = await prisma.tablet.findUnique({
      where: { id: Number(req.params.id) },
      include: { playlist: true },
    });
    if (!tablet) return res.status(404).json({ error: 'Tablet not found' });
    res.json(tablet);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const data = tabletSchema.partial().parse(req.body);
    const tablet = await prisma.tablet.update({
      where: { id: Number(req.params.id) },
      data,
    });
    res.json(tablet);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Tablet not found' });
    next(err);
  }
});

// #48 — POST /api/tablets/:id/force-sync — admin triggers next device sync
router.post('/:id/force-sync', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const tablet = await prisma.tablet.findUnique({ where: { id } });
    if (!tablet) return res.status(404).json({ error: 'Tablet not found' });
    forceSyncFlags.add(id);
    res.json({ ok: true, message: 'La tablet re-sincronizará en la próxima conexión.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
