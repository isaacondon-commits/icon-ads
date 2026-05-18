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

module.exports = router;
