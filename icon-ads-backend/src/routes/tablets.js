const router = require('express').Router();
const { z } = require('zod');
const crypto = require('crypto');
const QRCode = require('qrcode');
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const forceSyncFlags = require('../lib/forceSyncFlags');
const { audit } = require('../lib/auditLog');

router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid id' });
  next();
});

const tabletSchema = z.object({
  deviceId: z.string().min(1),
  name: z.string().min(1),
  zone: z.string().optional(),
  timezone: z.string().optional(),
  playlistId: z.number().int().positive().nullable().optional(),
  scheduleAt: z.string().datetime().nullable().optional(),
  notes: z.string().nullable().optional(),
  maintenanceUntil: z.string().datetime().nullable().optional(),
  driverName: z.string().nullable().optional(),
  licensePlate: z.string().nullable().optional(),
  spotPrice: z.number().positive().nullable().optional(),
  manualStatus: z.enum(['activa', 'mantenimiento', 'bloqueada']).optional(),
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

// ── Tablet groups (#5) ──────────────────────────────────────────────────────

router.get('/groups', async (req, res, next) => {
  try {
    const groups = await prisma.tabletGroup.findMany({
      include: {
        playlist: { select: { id: true, name: true } },
        _count: { select: { tablets: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json(groups);
  } catch (err) { next(err); }
});

router.post('/groups', requireAdmin, async (req, res, next) => {
  try {
    const { name, playlistId } = z.object({
      name: z.string().min(1),
      playlistId: z.number().int().positive().nullable().optional(),
    }).parse(req.body);
    const group = await prisma.tabletGroup.create({ data: { name, playlistId: playlistId ?? null } });
    await audit(req, 'CREATE', 'tablet_group', group.id, `Created group "${name}"`);
    res.status(201).json(group);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

router.put('/groups/:id', requireAdmin, async (req, res, next) => {
  try {
    const gid = Number(req.params.id);
    const { name, playlistId } = z.object({
      name: z.string().min(1).optional(),
      playlistId: z.number().int().positive().nullable().optional(),
    }).parse(req.body);
    const group = await prisma.tabletGroup.update({
      where: { id: gid },
      data: { ...(name ? { name } : {}), ...(playlistId !== undefined ? { playlistId: playlistId ?? null } : {}) },
    });
    if (playlistId !== undefined) {
      await prisma.tablet.updateMany({ where: { groupId: gid }, data: { playlistId: playlistId ?? null } });
    }
    await audit(req, 'UPDATE', 'tablet_group', gid, `Updated group "${group.name}"`);
    res.json(group);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Group not found' });
    next(err);
  }
});

router.delete('/groups/:id', requireAdmin, async (req, res, next) => {
  try {
    const gid = Number(req.params.id);
    const group = await prisma.tabletGroup.findUnique({ where: { id: gid } });
    if (!group) return res.status(404).json({ error: 'Group not found' });
    await prisma.tabletGroup.delete({ where: { id: gid } });
    await audit(req, 'DELETE', 'tablet_group', gid, `Deleted group "${group.name}"`);
    res.status(204).end();
  } catch (err) { next(err); }
});

router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { deviceId, name, zone, timezone, playlistId, scheduleAt, notes, maintenanceUntil, driverName, licensePlate, spotPrice } = tabletSchema.parse(req.body);
    const token = crypto.randomBytes(32).toString('hex');
    const tablet = await prisma.tablet.create({
      data: { deviceId, name, zone, timezone, playlistId,
              scheduleAt: scheduleAt ? new Date(scheduleAt) : null,
              notes, maintenanceUntil: maintenanceUntil ? new Date(maintenanceUntil) : null,
              driverName: driverName ?? null, licensePlate: licensePlate ?? null,
              spotPrice: spotPrice ?? null, token },
    });
    await audit(req, 'CREATE', 'tablet', tablet.id, `Registered "${tablet.name}"`);
    res.status(201).json(tablet);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.code === 'P2002') return res.status(409).json({ error: 'Device ID already registered' });
    next(err);
  }
});

// GET /export — CSV download of all tablets (#24)
router.get('/export', async (req, res, next) => {
  try {
    const tablets = await prisma.tablet.findMany({
      include: { playlist: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    const now = Date.now();
    const header = 'id,device_id,name,zone,playlist,status,last_sync,battery,app_version,os_version,device_model,created_at';
    const rows = tablets.map((t) => {
      const isOnline = t.lastSync && (now - new Date(t.lastSync).getTime()) < 10 * 60000;
      return [
        t.id,
        t.deviceId,
        `"${t.name.replace(/"/g, '""')}"`,
        t.zone ?? '',
        `"${(t.playlist?.name ?? '').replace(/"/g, '""')}"`,
        isOnline ? 'online' : 'offline',
        t.lastSync ? t.lastSync.toISOString() : '',
        t.batteryLevel ?? '',
        t.appVersion ?? '',
        t.osVersion ?? '',
        t.deviceModel ?? '',
        t.createdAt.toISOString(),
      ].join(',');
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tablets_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send([header, ...rows].join('\n'));
  } catch (err) { next(err); }
});

// GET /locations/live — last known position + status for all tablets
router.get('/locations/live', async (req, res, next) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
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
        id: t.id, name: t.name, zone: t.zone, lastSync: t.lastSync,
        batteryLevel: t.batteryLevel,
        playlist: t.playlist ? { id: t.playlist.id, name: t.playlist.name } : null,
        status: diffMin < 70 ? 'online' : 'offline',
        lat: t.lastLat ?? null,
        lng: t.lastLng ?? null,
        todayPlays: countMap[t.id] ?? 0,
      };
    });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /:id/location/history — today's GPS breadcrumb trail
router.get('/:id/location/history', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const tablet = await prisma.tablet.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!tablet) return res.status(404).json({ error: 'Not found' });
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const locations = await prisma.$queryRaw`
      SELECT lat, lng, accuracy, created_at
      FROM tablet_locations
      WHERE tablet_id = ${id} AND created_at >= ${todayStart}
      ORDER BY created_at ASC
    `;
    res.json({ tablet, locations });
  } catch (err) { next(err); }
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

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const data = tabletSchema.partial().parse(req.body);
    const parsed = { ...data };
    if (data.scheduleAt !== undefined) parsed.scheduleAt = data.scheduleAt ? new Date(data.scheduleAt) : null;
    if (data.maintenanceUntil !== undefined) parsed.maintenanceUntil = data.maintenanceUntil ? new Date(data.maintenanceUntil) : null;
    if (data.driverName !== undefined) parsed.driverName = data.driverName ?? null;
    if (data.licensePlate !== undefined) parsed.licensePlate = data.licensePlate ?? null;
    if (data.spotPrice !== undefined) parsed.spotPrice = data.spotPrice ?? null;
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

// GET /:id/sync-history — last 50 syncs + 7-day uptime (#1 #3)
router.get('/:id/sync-history', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const tablet = await prisma.tablet.findUnique({ where: { id } });
    if (!tablet) return res.status(404).json({ error: 'Tablet not found' });

    const [syncs, uptimeRows] = await Promise.all([
      prisma.syncLog.findMany({ where: { tabletId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.$queryRaw`
        WITH buckets AS (
          SELECT (EXTRACT(EPOCH FROM created_at)::BIGINT / 300) AS bucket
          FROM sync_logs
          WHERE tablet_id = ${id} AND created_at >= NOW() - INTERVAL '7 days' AND success = true
          GROUP BY 1
        )
        SELECT COUNT(*)::int AS online_buckets FROM buckets
      `,
    ]);

    const totalBuckets = 7 * 24 * 12;
    const onlineBuckets = Number(uptimeRows[0]?.online_buckets ?? 0);
    const uptimePct7d = Math.min(100, Math.round((onlineBuckets / totalBuckets) * 100));
    res.json({ syncs, uptimePct7d });
  } catch (err) { next(err); }
});

// POST /:id/message — send admin overlay message to tablet (#4)
router.post('/:id/message', requireAdmin, async (req, res, next) => {
  try {
    const { message } = z.object({ message: z.string().min(1).max(200) }).parse(req.body);
    const id = Number(req.params.id);
    const tablet = await prisma.tablet.findUnique({ where: { id } });
    if (!tablet) return res.status(404).json({ error: 'Tablet not found' });
    const msg = await prisma.tabletMessage.create({ data: { tabletId: id, message } });
    await audit(req, 'SEND_MESSAGE', 'tablet', id, `Mensaje a tablet: "${message.slice(0, 50)}"`);
    res.status(201).json(msg);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// PATCH /:id/group — assign tablet to a group (#5)
router.patch('/:id/group', requireAdmin, async (req, res, next) => {
  try {
    const { groupId } = z.object({ groupId: z.number().int().positive().nullable() }).parse(req.body);
    const id = Number(req.params.id);
    const tablet = await prisma.tablet.update({ where: { id }, data: { groupId: groupId ?? null } });
    res.json(tablet);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Tablet not found' });
    next(err);
  }
});

router.delete('/:id', requireAdmin, async (req, res, next) => {
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
router.post('/:id/force-sync', requireAdmin, async (req, res, next) => {
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
