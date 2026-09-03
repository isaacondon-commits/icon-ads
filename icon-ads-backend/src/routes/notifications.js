const router = require('express').Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/notifications — aggregated alerts for the notification bell (#26)
router.get('/', async (req, res, next) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const inSevenDays = new Date(today); inSevenDays.setDate(inSevenDays.getDate() + 7);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const systemAlerts = await prisma.$queryRawUnsafe(
      `SELECT id, type, severity, title, body, created_at AS "createdAt"
       FROM system_alerts WHERE acknowledged_at IS NULL ORDER BY id DESC LIMIT 50`,
    ).catch(() => []);

    const [pendingAds, expiringCampaigns, offlineTablets, allTablets] = await Promise.all([
      prisma.ad.count({ where: { approvalStatus: 'pending', deletedAt: null } }),
      prisma.campaign.findMany({
        where: { active: true, deletedAt: null, endDate: { lte: inSevenDays, gte: today } },
        select: { id: true, name: true, endDate: true },
        orderBy: { endDate: 'asc' },
      }),
      prisma.tablet.findMany({
        where: { lastSync: { lt: twoHoursAgo } },
        select: { id: true, name: true, lastSync: true },
      }),
      prisma.tablet.findMany({
        select: { id: true, lastSync: true, playlistId: true, playerOk: true, onFallback: true, manualStatus: true, batteryLevel: true },
      }),
    ]);

    // Contador para el badge de "Monitor": tablets que necesitan atención ahora.
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    let monitorAlerts = 0;
    for (const t of allTablets) {
      const online = t.lastSync && new Date(t.lastSync).getTime() > tenMinAgo;
      const problem =
        !online ||
        t.manualStatus === 'bloqueada' ||
        (online && t.playlistId && (t.playerOk === false || t.onFallback === true)) ||
        (online && t.batteryLevel != null && t.batteryLevel <= 20);
      if (problem) monitorAlerts++;
    }

    res.json({
      total: pendingAds + expiringCampaigns.length + offlineTablets.length,
      pendingAds,
      monitorAlerts,
      systemAlerts: (systemAlerts || []).map((a) => ({ ...a, id: Number(a.id) })),
      systemAlertCount: (systemAlerts || []).length,
      expiringCampaigns: expiringCampaigns.map((c) => ({
        id: c.id,
        name: c.name,
        daysLeft: Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000),
      })),
      offlineTablets: offlineTablets.map((t) => ({
        id: t.id,
        name: t.name,
        offlineMinutes: t.lastSync
          ? Math.floor((Date.now() - new Date(t.lastSync).getTime()) / 60000)
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
