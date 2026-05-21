const router = require('express').Router();
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

// POST /api/admin/seed — creates the first superadmin if no users exist
router.post('/seed', async (req, res, next) => {
  try {
    const count = await prisma.user.count();
    if (count > 0) return res.status(409).json({ message: 'Already seeded', users: count });

    const email = req.body.email || 'admin@iconads.com';
    const password = req.body.password || 'iconads2024';
    const name = req.body.name || 'Administrador';

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, password: hashed, name, role: 'superadmin' },
    });
    res.status(201).json({ message: 'Admin created', email: user.email });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/dashboard-stats — full system summary with alerts
router.get('/dashboard-stats', requireAuth, async (req, res, next) => {
  try {
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const onlineThreshold = new Date(now.getTime() - 10 * 60 * 1000);

    const [tablets, clients, campaigns, ads, totalPlays, pendingAds] = await Promise.all([
      prisma.tablet.findMany({
        select: { id: true, name: true, zone: true, lastSync: true, status: true },
      }),
      prisma.client.count({ where: { active: true, deletedAt: null } }),
      prisma.campaign.count({ where: { active: true, deletedAt: null } }),
      prisma.ad.count({ where: { active: true, deletedAt: null } }),
      prisma.metric.count(),
      prisma.ad.count({ where: { approvalStatus: 'pending', deletedAt: null } }),
    ]);

    const totalTablets = tablets.length;
    const onlineTablets = tablets.filter(
      (t) => t.lastSync && new Date(t.lastSync) >= onlineThreshold
    ).length;
    const offlineTablets = totalTablets - onlineTablets;
    const syncedToday = tablets.filter(
      (t) => t.lastSync && new Date(t.lastSync) >= todayStart
    ).length;
    const syncedYesterday = tablets.filter(
      (t) => t.lastSync && new Date(t.lastSync) >= yesterdayStart && new Date(t.lastSync) < todayStart
    ).length;
    const offlinePct = totalTablets > 0 ? Math.round((offlineTablets / totalTablets) * 100) : 0;

    res.json({
      tablets: {
        total: totalTablets,
        online: onlineTablets,
        offline: offlineTablets,
        offlinePct,
        syncedToday,
        syncedYesterday,
      },
      alerts: {
        massOffline: offlinePct > 20,
        massOfflineMsg: offlinePct > 20
          ? `${offlinePct}% de las tablets están offline (${offlineTablets}/${totalTablets})`
          : null,
        pendingAds: pendingAds > 0 ? `${pendingAds} anuncio(s) pendiente(s) de aprobación` : null,
      },
      counts: { clients, campaigns, ads, totalPlays, pendingAds },
      generatedAt: now.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/export/tablets — CSV export (#22)
router.get('/export/tablets', requireAuth, async (req, res, next) => {
  try {
    const tablets = await prisma.tablet.findMany({
      include: { playlist: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    const now = Date.now();
    const header = 'id,name,deviceId,zone,timezone,status,playlist,lastSync,notes,maintenanceUntil,createdAt';
    const rows = tablets.map((t) => {
      const isOnline = t.lastSync && (now - new Date(t.lastSync).getTime()) < 10 * 60000;
      return [
        t.id,
        `"${(t.name || '').replace(/"/g, '""')}"`,
        t.deviceId,
        `"${(t.zone || '').replace(/"/g, '""')}"`,
        t.timezone || '',
        isOnline ? 'online' : 'offline',
        `"${(t.playlist?.name || '').replace(/"/g, '""')}"`,
        t.lastSync ? new Date(t.lastSync).toISOString() : '',
        `"${(t.notes || '').replace(/"/g, '""')}"`,
        t.maintenanceUntil ? new Date(t.maintenanceUntil).toISOString() : '',
        new Date(t.createdAt).toISOString(),
      ].join(',');
    });
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tablets_${date}.csv"`);
    res.send([header, ...rows].join('\n'));
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/stats/zones — plays and tablet count grouped by zone (#24)
router.get('/stats/zones', requireAuth, async (req, res, next) => {
  try {
    const tablets = await prisma.tablet.findMany({
      select: { id: true, zone: true, lastSync: true },
    });
    const now = Date.now();
    const onlineThreshold = now - 10 * 60 * 1000;

    const zoneMap = {};
    for (const t of tablets) {
      const z = t.zone || 'Sin zona';
      if (!zoneMap[z]) zoneMap[z] = { zone: z, tablets: 0, online: 0, plays: 0 };
      zoneMap[z].tablets++;
      if (t.lastSync && new Date(t.lastSync).getTime() > onlineThreshold) zoneMap[z].online++;
    }

    const playsRows = await prisma.$queryRaw`
      SELECT COALESCE(t.zone, 'Sin zona') AS zone, COUNT(m.id)::int AS plays
      FROM metrics m
      JOIN tablets t ON m.tablet_id = t.id
      GROUP BY t.zone
    `;

    for (const row of playsRows) {
      const z = row.zone;
      if (zoneMap[z]) zoneMap[z].plays = Number(row.plays);
    }

    res.json(Object.values(zoneMap).sort((a, b) => b.tablets - a.tablets));
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/backup — full JSON export of key data (#42)
router.get('/backup', requireAuth, async (req, res, next) => {
  try {
    const [clients, campaigns, ads, playlists, tablets] = await Promise.all([
      prisma.client.findMany({ where: { deletedAt: null } }),
      prisma.campaign.findMany({ where: { deletedAt: null } }),
      prisma.ad.findMany({
        where: { deletedAt: null },
        select: { id: true, campaignId: true, name: true, type: true, filename: true, durationS: true, active: true, approvalStatus: true, priority: true, tags: true, createdAt: true, updatedAt: true },
      }),
      prisma.playlist.findMany({ include: { playlistAds: { select: { adId: true, order: true } } } }),
      prisma.tablet.findMany({
        select: { id: true, deviceId: true, name: true, zone: true, status: true, lastSync: true, appVersion: true, osVersion: true, deviceModel: true, batteryLevel: true, createdAt: true },
      }),
    ]);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="iconads_backup_${date}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      version: '1.0',
      counts: { clients: clients.length, campaigns: campaigns.length, ads: ads.length, playlists: playlists.length, tablets: tablets.length },
      data: { clients, campaigns, ads, playlists, tablets },
    });
  } catch (err) { next(err); }
});

module.exports = router;
