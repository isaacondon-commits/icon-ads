const router = require('express').Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/stats — global stats + chart data (#35 enhanced)
router.get('/', async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    // Expiring campaigns: active, not deleted, ending within 7 days
    const inSevenDays = new Date(today);
    inSevenDays.setDate(inSevenDays.getDate() + 7);

    const [tabletList, clientCount, campaignCount, adCount, dailyRows, campaignRows, totalPlays, expiringCampaigns] =
      await Promise.all([
        prisma.tablet.findMany({ select: { lastSync: true } }),
        prisma.client.count({ where: { active: true, deletedAt: null } }),
        prisma.campaign.count({ where: { active: true, deletedAt: null } }),
        prisma.ad.count({ where: { active: true, deletedAt: null } }),
        prisma.$queryRaw`
          SELECT DATE(played_at AT TIME ZONE 'UTC') AS date, COUNT(*)::int AS count
          FROM metrics WHERE played_at >= ${sevenDaysAgo}
          GROUP BY DATE(played_at AT TIME ZONE 'UTC') ORDER BY date ASC
        `,
        prisma.$queryRaw`
          SELECT c.id AS "campaignId", c.name AS "campaignName", COUNT(m.id)::int AS count
          FROM metrics m JOIN campaigns c ON m.campaign_id = c.id
          GROUP BY c.id, c.name ORDER BY count DESC LIMIT 10
        `,
        prisma.metric.count(),
        prisma.campaign.findMany({
          where: { active: true, deletedAt: null, endDate: { lte: inSevenDays, gte: today } },
          include: { client: { select: { name: true } } },
          orderBy: { endDate: 'asc' },
        }),
      ]);

    const now = Date.now();
    const onlineCount = tabletList.filter(
      (t) => t.lastSync && now - new Date(t.lastSync).getTime() < 10 * 60000
    ).length;

    const dayMap = Object.fromEntries(
      dailyRows.map((r) => [String(r.date).slice(0, 10), Number(r.count)])
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
      totalPlays,
      dailyPlays,
      playsByCampaign: campaignRows.map((r) => ({
        campaignId: Number(r.campaignId),
        campaignName: r.campaignName,
        count: Number(r.count),
      })),
      expiringCampaigns: expiringCampaigns.map((c) => ({
        id: c.id,
        name: c.name,
        clientName: c.client?.name ?? '—',
        endDate: c.endDate,
        daysLeft: Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/weekly — week-over-week for last N weeks (#20)
router.get('/weekly', async (req, res, next) => {
  try {
    const weeks = Math.min(8, parseInt(req.query.weeks) || 4);
    const result = [];
    for (let w = weeks - 1; w >= 0; w--) {
      const from = new Date();
      from.setDate(from.getDate() - (w + 1) * 7);
      from.setHours(0, 0, 0, 0);
      const to = new Date(from);
      to.setDate(to.getDate() + 7);
      const count = await prisma.metric.count({ where: { playedAt: { gte: from, lt: to } } });
      result.push({
        week: `Sem -${w}`,
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
        count,
      });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/range?from=&to= — plays filtered by date range (#13)
router.get('/range', async (req, res, next) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 86400000);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    to.setHours(23, 59, 59, 999);

    const [dailyRows, campaignRows, tabletRows, adRows] = await Promise.all([
      prisma.$queryRaw`
        SELECT DATE(played_at AT TIME ZONE 'UTC') AS date, COUNT(*)::int AS count
        FROM metrics WHERE played_at BETWEEN ${from} AND ${to}
        GROUP BY DATE(played_at AT TIME ZONE 'UTC') ORDER BY date ASC
      `,
      prisma.$queryRaw`
        SELECT c.id AS "campaignId", c.name AS "campaignName", COUNT(m.id)::int AS count
        FROM metrics m JOIN campaigns c ON m.campaign_id = c.id
        WHERE m.played_at BETWEEN ${from} AND ${to}
        GROUP BY c.id, c.name ORDER BY count DESC LIMIT 10
      `,
      prisma.$queryRaw`
        SELECT t.id AS "tabletId", t.name AS "tabletName", COUNT(m.id)::int AS count
        FROM metrics m JOIN tablets t ON m.tablet_id = t.id
        WHERE m.played_at BETWEEN ${from} AND ${to}
        GROUP BY t.id, t.name ORDER BY count DESC LIMIT 10
      `,
      prisma.$queryRaw`
        SELECT a.id AS "adId", a.name AS "adName", COUNT(m.id)::int AS count
        FROM metrics m JOIN ads a ON m.ad_id = a.id
        WHERE m.played_at BETWEEN ${from} AND ${to}
        GROUP BY a.id, a.name ORDER BY count DESC LIMIT 10
      `,
    ]);

    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      totalPlays: dailyRows.reduce((s, r) => s + Number(r.count), 0),
      dailyPlays: dailyRows.map((r) => ({ date: String(r.date).slice(0, 10), count: Number(r.count) })),
      playsByCampaign: campaignRows.map((r) => ({ campaignId: Number(r.campaignId), campaignName: r.campaignName, count: Number(r.count) })),
      playsByTablet: tabletRows.map((r) => ({ tabletId: Number(r.tabletId), tabletName: r.tabletName, count: Number(r.count) })),
      playsByAd: adRows.map((r) => ({ adId: Number(r.adId), adName: r.adName, count: Number(r.count) })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/metrics/export — CSV download
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
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="metrics_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send([header, ...rows].join('\n'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
