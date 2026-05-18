const router = require('express').Router();
const { z } = require('zod');
const crypto = require('crypto');
const QRCode = require('qrcode');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const forceSyncFlags = require('../lib/forceSyncFlags');
const { audit } = require('../lib/auditLog');

router.use(requireAuth);

const tabletSchema = z.object({
  deviceId: z.string().min(1),
  name: z.string().min(1),
  zone: z.string().optional(),
  timezone: z.string().optional(),
  playlistId: z.number().int().positive().nullable().optional(),
  scheduleAt: z.string().datetime().nullable().optional(),
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

// GET /api/tablets/monitor — live stats per tablet (#27)
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
      return {
        id: t.id,
        name: t.name,
        deviceId: t.deviceId,
        zone: t.zone,
        timezone: t.timezone,
        status: diffMin < 10 ? 'online' : 'offline',
        offlineMinutes: Math.floor(diffMin),
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
    const { deviceId, name, zone, timezone, playlistId, scheduleAt } = tabletSchema.parse(req.body);
    const token = crypto.randomBytes(32).toString('hex');
    const tablet = await prisma.tablet.create({
      data: { deviceId, name, zone, timezone, playlistId, scheduleAt: scheduleAt ? new Date(scheduleAt) : null, token },
    });
    await audit(req, 'CREATE', 'tablet', tablet.id, `Registered "${tablet.name}"`);
    res.status(201).json(tablet);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.code === 'P2002') return res.status(409).json({ error: 'Device ID already registered' });
    next(err);
  }
});

// GET /:id — full detail with sync history / error logs (#29)
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [tablet, errorLogs, playsToday, playsAllTime] = await Promise.all([
      prisma.tablet.findUnique({
        where: { id },
        include: { playlist: { select: { id: true, name: true, version: true } } },
      }),
      prisma.errorLog.findMany({
        where: { tabletId: id },
        orderBy: { occurredAt: 'desc' },
        take: 20,
      }),
      prisma.metric.count({ where: { tabletId: id, playedAt: { gte: today } } }),
      prisma.metric.count({ where: { tabletId: id } }),
    ]);
    if (!tablet) return res.status(404).json({ error: 'Tablet not found' });
    res.json({ ...tablet, errorLogs, playsToday, playsAllTime });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const data = tabletSchema.partial().parse(req.body);
    const parsed = { ...data };
    if (data.scheduleAt !== undefined) parsed.scheduleAt = data.scheduleAt ? new Date(data.scheduleAt) : null;
    const tablet = await prisma.tablet.update({ where: { id: Number(req.params.id) }, data: parsed });
    await audit(req, 'UPDATE', 'tablet', tablet.id, `Updated "${tablet.name}"`);
    res.json(tablet);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Tablet not found' });
    next(err);
  }
});

// GET /:id/qr — QR code PNG for quick tablet identification (#21)
router.get('/:id/qr', async (req, res, next) => {
  try {
    const tablet = await prisma.tablet.findUnique({ where: { id: Number(req.params.id) } });
    if (!tablet) return res.status(404).json({ error: 'Tablet not found' });
    const content = JSON.stringify({ deviceId: tablet.deviceId, name: tablet.name, id: tablet.id });
    const png = await QRCode.toBuffer(content, { type: 'png', width: 300, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const tablet = await prisma.tablet.findUnique({ where: { id } });
    if (!tablet) return res.status(404).json({ error: 'Tablet not found' });
    await prisma.tablet.delete({ where: { id } });
    await audit(req, 'DELETE', 'tablet', id, `Deleted "${tablet.name}"`);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// POST /:id/force-sync (#48)
router.post('/:id/force-sync', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const tablet = await prisma.tablet.findUnique({ where: { id } });
    if (!tablet) return res.status(404).json({ error: 'Tablet not found' });
    forceSyncFlags.add(id);
    await audit(req, 'FORCE_SYNC', 'tablet', id, `Forced sync on "${tablet.name}"`);
    res.json({ ok: true, message: 'La tablet re-sincronizará en la próxima conexión.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
