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

    const [pendingAds, expiringCampaigns, offlineTablets] = await Promise.all([
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
    ]);

    res.json({
      total: pendingAds + expiringCampaigns.length + offlineTablets.length,
      pendingAds,
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
