const router = require('express').Router();
const { z } = require('zod');
const crypto = require('crypto');
const QRCode = require('qrcode');
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const forceSyncFlags = require('../lib/forceSyncFlags');
const { audit } = require('../lib/auditLog');
const firebaseAdmin = require('../lib/firebase-admin');
const { computeStandby } = require('../lib/standby');

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
  rotated180: z.boolean().optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const tablets = await prisma.tablet.findMany({
      include: {
        playlist: {
          select: {
            id: true, name: true, version: true,
            playlistAds: { select: { ad: { select: { campaign: { select: { id: true, name: true } } } } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    // Campañas a las que "pertenece" cada tablet = campañas con al menos un
    // anuncio en la playlist asignada (deduplicadas).
    const shaped = tablets.map((t) => {
      const byId = new Map();
      for (const pa of t.playlist?.playlistAds ?? []) {
        const c = pa.ad?.campaign;
        if (c) byId.set(c.id, c.name);
      }
      const campaigns = [...byId].map(([id, name]) => ({ id, name }));
      const playlist = t.playlist
        ? { id: t.playlist.id, name: t.playlist.name, version: t.playlist.version }
        : null;
      return { ...t, playlist, campaigns };
    });
    res.json(shaped);
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
      const online = diffMin < 10;
      // Salud: 'blocked' si el operador la bloqueó desde el panel; 'offline' si
      // no sincroniza; 'no-reproduce' si está online, tiene playlist y el player
      // reporta que NO está mostrando anuncios; 'ok' si no.
      let health = 'ok';
      if (t.manualStatus === 'bloqueada') health = 'blocked';
      else if (!online) health = 'offline';
      else if (!t.playlistId) health = 'sin-playlist';
      else if (t.playerOk === false || t.onFallback === true) health = 'no-reproduce';
      return {
        id: t.id,
        name: t.name,
        deviceId: t.deviceId,
        zone: t.zone,
        timezone: t.timezone,
        status: online ? 'online' : 'offline',
        health,
        manualStatus: t.manualStatus ?? 'activa',
        driverName: t.driverName ?? null,
        licensePlate: t.licensePlate ?? null,
        offlineMinutes: Math.floor(diffMin),
        lastSync: t.lastSync,
        playlist: t.playlist ? { id: t.playlist.id, name: t.playlist.name } : null,
        todayPlays: countMap[t.id] ?? 0,
        batteryLevel: t.batteryLevel ?? null,
        brightness: t.brightness ?? null,
        brightnessAuto: t.brightnessAuto ?? null,
        serial: t.serial ?? null,
        appVersion: t.appVersion ?? null,
        playerOk: t.playerOk ?? null,
        onFallback: t.onFallback ?? null,
        lux: t.lux ?? null,
        lightSensor: t.lightSensor ?? null,
        lastAdAgoS: t.lastAdAgoS ?? null,
        hasScreenshot: !!t.lastScreenshotAt,
        lastScreenshotAt: t.lastScreenshotAt ?? null,
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
        // Mismo criterio que GET /monitor: la tablet sincroniza cada ~30 s
        // mientras el player corre, así que 10 min sin sync = offline.
        status: diffMin < 10 ? 'online' : 'offline',
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

// GET /:id/standby — tiempo que el taxi estuvo parado, estimado del rastro GPS.
// ?date=YYYY-MM-DD (default: hoy). Rango consultable: últimos 7 días (retención GPS).
router.get('/:id/standby', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const tablet = await prisma.tablet.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!tablet) return res.status(404).json({ error: 'Not found' });

    let dayStart;
    if (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
      dayStart = new Date(`${req.query.date}T00:00:00`);
      if (Number.isNaN(dayStart.getTime())) return res.status(400).json({ error: 'Fecha inválida' });
    } else {
      dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
    }
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const points = await prisma.$queryRaw`
      SELECT lat, lng, created_at
      FROM tablet_locations
      WHERE tablet_id = ${id} AND created_at >= ${dayStart} AND created_at < ${dayEnd}
      ORDER BY created_at ASC
    `;
    const result = computeStandby(points);
    res.json({
      tablet,
      date: dayStart.toISOString().slice(0, 10),
      points: points.length,
      ...result,
    });
  } catch (err) { next(err); }
});

// GET /:id — full detail with sync history / error logs (#29)
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [tablet, errorLogs, playsToday, playsAllTime, todayLocations] = await Promise.all([
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
      prisma.$queryRaw`
        SELECT lat, lng, created_at FROM tablet_locations
        WHERE tablet_id = ${id} AND created_at >= ${today}
        ORDER BY created_at ASC
      `,
    ]);
    if (!tablet) return res.status(404).json({ error: 'Tablet not found' });
    const standbyToday = computeStandby(todayLocations);
    res.json({ ...tablet, errorLogs, playsToday, playsAllTime, standbyToday });
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
    if (err.code === 'P2003') return res.status(409).json({ error: 'No se pudo eliminar: tiene datos relacionados que lo impiden' });
    next(err);
  }
});

// POST /force-sync-all — flag every tablet for re-sync, pushing instantly via FCM
// to whichever ones have already registered a push token (older APKs without FCM
// fall back to the flag, applied on their next periodic connection)
router.post('/force-sync-all', requireAdmin, async (req, res, next) => {
  try {
    const tablets = await prisma.tablet.findMany({ select: { id: true, fcmToken: true } });
    tablets.forEach((t) => forceSyncFlags.add(t.id));
    // Push best-effort en background — no se espera (FCM lento desde Render daba
    // "failed to fetch"). El flag se aplica en el próximo sync igual.
    firebaseAdmin.sendSyncPush(tablets.map((t) => t.fcmToken).filter(Boolean)).catch(() => {});
    audit(req, 'FORCE_SYNC_ALL', 'tablet', null, `Forced sync on ${tablets.length} tablets`).catch(() => {});
    res.json({ ok: true, count: tablets.length, message: `${tablets.length} tablets marcadas — sincronizan en su próximo ciclo (≤10 s en modo test).` });
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
    // Push FCM best-effort en background — no se espera (FCM lento desde Render
    // daba "failed to fetch"). La tablet lo agarra en su próximo ciclo igual.
    if (tablet.fcmToken) firebaseAdmin.sendSyncPush([tablet.fcmToken]).catch(() => {});
    audit(req, 'FORCE_SYNC', 'tablet', id, `Forced sync on "${tablet.name}"`).catch(() => {});
    const noPlaylist = !tablet.playlistId;
    res.json({
      ok: true,
      message: noPlaylist
        ? 'Marcada, pero esta tablet NO tiene playlist asignada — no va a mostrar nada hasta que le asignes una.'
        : 'Marcada — sincroniza en su próximo ciclo (≤10 s en modo test).',
    });
  } catch (err) {
    next(err);
  }
});

// POST /:id/regenerate-token — revoke the current device token and issue a new
// one (lost/stolen tablet, or suspected token leak). The tablet detects the old
// token stops working (401 on its next sync) and re-registers automatically —
// it doesn't need to be touched, as long as it can still reach the deviceId it
// registered with.
router.post('/:id/regenerate-token', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const token = crypto.randomBytes(32).toString('hex');
    const tablet = await prisma.tablet.update({ where: { id }, data: { token } });
    await audit(req, 'REGENERATE_TOKEN', 'tablet', id, `Regenerated token for "${tablet.name}"`);
    res.json({ ok: true, message: 'Token regenerado. La tablet se re-registrará sola en su próximo intento de sync.' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Tablet not found' });
    next(err);
  }
});

module.exports = router;
