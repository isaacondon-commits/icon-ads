const router = require('express').Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/driver-points — leaderboard
router.get('/', async (req, res, next) => {
  try {
    const points = await prisma.driverPoints.findMany({
      include: { tablet: { select: { id: true, name: true, zone: true, driverName: true, licensePlate: true } } },
      orderBy: { points: 'desc' },
    });
    res.json(points);
  } catch (err) { next(err); }
});

// POST /api/driver-points/recalculate — recompute points from sync logs
router.post('/recalculate', async (req, res, next) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const tablets = await prisma.tablet.findMany({ select: { id: true } });

    const results = await Promise.all(tablets.map(async (t) => {
      const syncs30d = await prisma.syncLog.count({
        where: { tabletId: t.id, createdAt: { gte: thirtyDaysAgo }, success: true },
      });
      // Points: 1 per sync, bonus 50 for >200 syncs (very active), bonus 20 for >100
      const bonus = syncs30d > 200 ? 50 : syncs30d > 100 ? 20 : 0;
      const points = syncs30d + bonus;

      return prisma.driverPoints.upsert({
        where: { tabletId: t.id },
        update: { points, syncs30d, lastCalculated: new Date() },
        create: { tabletId: t.id, points, syncs30d },
      });
    }));

    res.json({ recalculated: results.length, topPoints: Math.max(...results.map((r) => r.points), 0) });
  } catch (err) { next(err); }
});

module.exports = router;
