const router = require('express').Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// #58 — GET /api/stats — global system stats + chart data
router.get('/', async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const [tabletList, clientCount, campaignCount, adCount, dailyRows, campaignRows] =
      await Promise.all([
        prisma.tablet.findMany({ select: { lastSync: true } }),
        prisma.client.count({ where: { active: true } }),
        prisma.campaign.count({ where: { active: true } }),
        prisma.ad.count({ where: { active: true } }),

        // plays grouped by day (last 7 days)
        prisma.$queryRaw`
          SELECT
            DATE(played_at AT TIME ZONE 'UTC') AS date,
            COUNT(*)::int AS count
          FROM metrics
          WHERE played_at >= ${sevenDaysAgo}
          GROUP BY DATE(played_at AT TIME ZONE 'UTC')
          ORDER BY date ASC
        `,

        // plays grouped by campaign (top 10)
        prisma.$queryRaw`
          SELECT
            c.id AS "campaignId",
            c.name AS "campaignName",
            COUNT(m.id)::int AS count
          FROM metrics m
          JOIN campaigns c ON m.campaign_id = c.id
          GROUP BY c.id, c.name
          ORDER BY count DESC
          LIMIT 10
        `,
      ]);

    const now = Date.now();
    const onlineCount = tabletList.filter(
      (t) => t.lastSync && now - new Date(t.lastSync).getTime() < 70 * 60000
    ).length;

    // Fill missing days with 0
    const dayMap = Object.fromEntries(
      (dailyRows).map((r) => [String(r.date).slice(0, 10), Number(r.count)])
    );
    const dailyPlays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      return { date: key, count: dayMap[key] ?? 0 };
    });

    res.json({
      tablets: { total: tabletList.length, online: onlineCount },
      clients: clientCount,
      campaigns: campaignCount,
      ads: adCount,
      dailyPlays,
      playsByCampaign: campaignRows.map((r) => ({
        campaignId: Number(r.campaignId),
        campaignName: r.campaignName,
        count: Number(r.count),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// #16 — GET /api/stats/metrics/export — download all metrics as CSV
router.get('/metrics/export', async (req, res, next) => {
  try {
    const metrics = await prisma.metric.findMany({
      include: {
        tablet: { select: { name: true, deviceId: true } },
        ad: { select: { name: true } },
        campaign: { select: { name: true } },
      },
      orderBy: { playedAt: 'desc' },
    });

    const header = 'id,tablet,device_id,ad,campaign,played_at,duration_s,completed,error';
    const rows = metrics.map((m) =>
      [
        m.id,
        `"${m.tablet.name.replace(/"/g, '""')}"`,
        m.tablet.deviceId,
        `"${m.ad.name.replace(/"/g, '""')}"`,
        `"${m.campaign.name.replace(/"/g, '""')}"`,
        m.playedAt.toISOString(),
        m.durationPlayedS,
        m.completed ? 1 : 0,
        m.error ? 1 : 0,
      ].join(',')
    );

    const csv = [header, ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="metrics_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
