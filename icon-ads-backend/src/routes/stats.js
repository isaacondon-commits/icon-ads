const router = require('express').Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const latencyTracker = require('../lib/latencyTracker');

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

// GET /api/stats/roi — campaigns ranked by estimated revenue (#15)
router.get('/roi', async (req, res, next) => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT c.id AS "campaignId", c.name AS "campaignName",
             cl.name AS "clientName",
             c.cpm, c.budget, c.target_impressions AS "targetImpressions",
             COUNT(m.id)::int AS plays,
             ROUND((COUNT(m.id)::float / 1000 * COALESCE(c.cpm, 5))::numeric, 2) AS "estimatedRevenue"
      FROM campaigns c
      LEFT JOIN metrics m ON m.campaign_id = c.id
      LEFT JOIN clients cl ON cl.id = c.client_id
      WHERE c.deleted_at IS NULL
      GROUP BY c.id, c.name, cl.name, c.cpm, c.budget, c.target_impressions
      ORDER BY "estimatedRevenue" DESC
      LIMIT 20
    `;
    res.json(rows.map((r) => ({
      campaignId: Number(r.campaignId),
      campaignName: r.campaignName,
      clientName: r.clientName ?? '—',
      cpm: r.cpm !== null ? Number(r.cpm) : null,
      budget: r.budget !== null ? Number(r.budget) : null,
      targetImpressions: r.targetImpressions !== null ? Number(r.targetImpressions) : null,
      plays: Number(r.plays),
      estimatedRevenue: Number(r.estimatedRevenue),
    })));
  } catch (err) { next(err); }
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

// GET /api/stats/by-tablet-ad?from=&to= — which ads each tablet played, and
// how many times (playsByTablet/playsByAd on /range only give totals per
// side, not the cross breakdown)
router.get('/by-tablet-ad', async (req, res, next) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 86400000);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    to.setHours(23, 59, 59, 999);

    const rows = await prisma.$queryRaw`
      SELECT t.id AS "tabletId", t.name AS "tabletName", a.id AS "adId", a.name AS "adName", COUNT(m.id)::int AS count
      FROM metrics m
      JOIN tablets t ON m.tablet_id = t.id
      JOIN ads a ON m.ad_id = a.id
      WHERE m.played_at BETWEEN ${from} AND ${to}
      GROUP BY t.id, t.name, a.id, a.name
      ORDER BY t.name ASC, count DESC
    `;

    res.json(rows.map((r) => ({
      tabletId: Number(r.tabletId), tabletName: r.tabletName,
      adId: Number(r.adId), adName: r.adName, count: Number(r.count),
    })));
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/heatmap?from=&to= — plays per hour of day (#11)
router.get('/heatmap', async (req, res, next) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 86400000);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    to.setHours(23, 59, 59, 999);
    const rows = await prisma.$queryRaw`
      SELECT EXTRACT(HOUR FROM played_at AT TIME ZONE 'UTC')::int AS hour, COUNT(*)::int AS count
      FROM metrics WHERE played_at BETWEEN ${from} AND ${to}
      GROUP BY hour ORDER BY hour ASC
    `;
    const heatmap = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
    for (const r of rows) heatmap[Number(r.hour)].count = Number(r.count);
    res.json(heatmap);
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/heatmap-by-day?from=&to= — plays per hour, broken down by
// calendar day, for the day × hour grid version of /heatmap
router.get('/heatmap-by-day', async (req, res, next) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 86400000);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    to.setHours(23, 59, 59, 999);
    const rows = await prisma.$queryRaw`
      SELECT DATE(played_at AT TIME ZONE 'UTC') AS date,
             EXTRACT(HOUR FROM played_at AT TIME ZONE 'UTC')::int AS hour,
             COUNT(*)::int AS count
      FROM metrics WHERE played_at BETWEEN ${from} AND ${to}
      GROUP BY DATE(played_at AT TIME ZONE 'UTC'), hour
      ORDER BY date ASC, hour ASC
    `;
    res.json(rows.map((r) => ({ date: String(r.date).slice(0, 10), hour: Number(r.hour), count: Number(r.count) })));
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/completion?from=&to= — completion rate per ad (#12)
router.get('/completion', async (req, res, next) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 86400000);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    to.setHours(23, 59, 59, 999);
    const rows = await prisma.$queryRaw`
      SELECT a.id AS "adId", a.name AS "adName",
        COUNT(m.id)::int AS "totalPlays",
        SUM(CASE WHEN m.completed THEN 1 ELSE 0 END)::int AS "completedPlays"
      FROM metrics m JOIN ads a ON m.ad_id = a.id
      WHERE m.played_at BETWEEN ${from} AND ${to}
      GROUP BY a.id, a.name ORDER BY "totalPlays" DESC LIMIT 15
    `;
    res.json(rows.map((r) => ({
      adId: Number(r.adId),
      adName: r.adName,
      totalPlays: Number(r.totalPlays),
      completedPlays: Number(r.completedPlays),
      completionRate: Number(r.totalPlays) > 0
        ? Math.round((Number(r.completedPlays) / Number(r.totalPlays)) * 1000) / 10
        : 0,
    })));
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/metrics — paginated raw play records (#22)
router.get('/metrics', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;
    const [total, records] = await Promise.all([
      prisma.metric.count(),
      prisma.metric.findMany({
        skip, take: limit,
        orderBy: { playedAt: 'desc' },
        include: {
          tablet: { select: { name: true } },
          ad: { select: { name: true } },
          campaign: { select: { name: true } },
        },
      }),
    ]);
    res.json({
      total, page, pages: Math.ceil(total / limit),
      records: records.map((m) => ({
        id: m.id,
        tabletName: m.tablet.name,
        adName: m.ad.name,
        campaignName: m.campaign.name,
        playedAt: m.playedAt,
        durationPlayedS: m.durationPlayedS,
        completed: m.completed,
        error: m.error,
      })),
    });
  } catch (err) { next(err); }
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

// GET /api/stats/playlists?from=&to= — plays per playlist (#3)
router.get('/playlists', async (req, res, next) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 86400000);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    to.setHours(23, 59, 59, 999);

    const [playlists, metricsRows] = await Promise.all([
      prisma.playlist.findMany({
        select: { id: true, name: true, _count: { select: { tablets: true } } },
        orderBy: { name: 'asc' },
      }),
      prisma.$queryRaw`
        SELECT pa.playlist_id AS "playlistId", COUNT(m.id)::int AS count
        FROM metrics m
        JOIN playlist_ads pa ON pa.ad_id = m.ad_id
        WHERE m.played_at BETWEEN ${from} AND ${to}
        GROUP BY pa.playlist_id
      `,
    ]);

    const countMap = Object.fromEntries(metricsRows.map((r) => [Number(r.playlistId), Number(r.count)]));
    res.json(
      playlists
        .map((p) => ({ playlistId: p.id, playlistName: p.name, tabletCount: p._count.tablets, totalPlays: countMap[p.id] ?? 0 }))
        .sort((a, b) => b.totalPlays - a.totalPlays)
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/occupancy — paid vs available time per tablet (#8)
router.get('/occupancy', async (req, res, next) => {
  try {
    const tablets = await prisma.tablet.findMany({
      where: { playlistId: { not: null } },
      select: {
        id: true, name: true, zone: true,
        playlist: {
          select: {
            playlistAds: {
              select: {
                ad: {
                  select: {
                    durationS: true,
                    campaign: { select: { active: true, deletedAt: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    const result = tablets.map((t) => {
      const ads = t.playlist?.playlistAds ?? [];
      const totalDurationS = ads.reduce((s, pa) => s + pa.ad.durationS, 0);
      const paidDurationS = ads
        .filter((pa) => pa.ad.campaign.active && !pa.ad.campaign.deletedAt)
        .reduce((s, pa) => s + pa.ad.durationS, 0);
      const occupancyPct = totalDurationS > 0 ? Math.round((paidDurationS / totalDurationS) * 100) : 0;
      return { tabletId: t.id, tabletName: t.name, zone: t.zone, totalDurationS, paidDurationS, occupancyPct };
    });

    res.json(result.sort((a, b) => b.occupancyPct - a.occupancyPct));
  } catch (err) { next(err); }
});

// GET /api/stats/sync-intervals — avg minutes between syncs per tablet, last 7 days (#14)
router.get('/sync-intervals', async (req, res, next) => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT
        t.id AS "tabletId",
        t.name AS "tabletName",
        t.zone AS "zone",
        COUNT(sl.id)::int AS "syncCount",
        CASE WHEN COUNT(sl.id) > 1 THEN
          ROUND(
            EXTRACT(EPOCH FROM (MAX(sl.created_at) - MIN(sl.created_at))) /
            (COUNT(sl.id) - 1) / 60
          )::int
        ELSE NULL END AS "avgMinutes"
      FROM sync_logs sl
      JOIN tablets t ON t.id = sl.tablet_id
      WHERE sl.created_at >= NOW() - INTERVAL '7 days' AND sl.success = true
      GROUP BY t.id, t.name, t.zone
      ORDER BY "avgMinutes" ASC NULLS LAST
    `;
    res.json(rows.map((r) => ({
      tabletId: Number(r.tabletId),
      tabletName: r.tabletName,
      zone: r.zone,
      syncCount: Number(r.syncCount),
      avgMinutes: r.avgMinutes !== null ? Number(r.avgMinutes) : null,
    })));
  } catch (err) { next(err); }
});

// GET /api/stats/latency — in-memory endpoint latency summary (#43)
router.get('/latency', (req, res) => {
  res.json(latencyTracker.getSummary());
});

// GET /api/stats/zone-hour — plays per zone per hour of day, last 30 days (#52)
router.get('/zone-hour', async (req, res, next) => {
  try {
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await prisma.$queryRaw`
      SELECT
        COALESCE(t.zone, 'Sin zona') AS zone,
        EXTRACT(HOUR FROM m.played_at AT TIME ZONE 'UTC')::int AS hour,
        COUNT(*)::int AS count
      FROM metrics m
      JOIN tablets t ON m.tablet_id = t.id
      WHERE m.played_at >= ${from}
      GROUP BY COALESCE(t.zone, 'Sin zona'), EXTRACT(HOUR FROM m.played_at AT TIME ZONE 'UTC')
      ORDER BY zone, hour
    `;
    res.json(rows.map((r) => ({ zone: r.zone, hour: Number(r.hour), count: Number(r.count) })));
  } catch (err) { next(err); }
});

// GET /api/stats/sla — tablet sync coverage (active days) in last 30 days (#59)
router.get('/sla', async (req, res, next) => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT
        t.id AS "tabletId",
        t.name AS "tabletName",
        t.zone,
        COUNT(sl.id)::int AS "syncCount30d",
        COUNT(DISTINCT DATE(sl.created_at AT TIME ZONE 'UTC'))::int AS "activeDays30d"
      FROM tablets t
      LEFT JOIN sync_logs sl ON sl.tablet_id = t.id AND sl.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY t.id, t.name, t.zone
      ORDER BY "activeDays30d" DESC
    `;
    res.json(rows.map((r) => ({
      tabletId: Number(r.tabletId),
      tabletName: r.tabletName,
      zone: r.zone,
      syncCount30d: Number(r.syncCount30d),
      activeDays30d: Number(r.activeDays30d),
      coveragePct: Math.min(100, Math.round((Number(r.activeDays30d) / 30) * 100)),
    })));
  } catch (err) { next(err); }
});

// GET /api/stats/monthly — plays per month, last 12 months (#38)
router.get('/monthly', async (req, res, next) => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT
        TO_CHAR(DATE_TRUNC('month', played_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
        COUNT(*)::int AS count
      FROM metrics
      WHERE played_at >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', played_at AT TIME ZONE 'UTC')
      ORDER BY month
    `;
    res.json(rows.map((r) => ({ month: String(r.month), count: Number(r.count) })));
  } catch (err) { next(err); }
});

// GET /api/stats/by-zone — tablets and plays grouped by zone (#35)
router.get('/by-zone', async (req, res, next) => {
  try {
    const cutoff = new Date(Date.now() - 70 * 60 * 1000);
    const rows = await prisma.$queryRaw`
      SELECT
        COALESCE(t.zone, 'Sin zona') AS zone,
        COUNT(DISTINCT t.id)::int AS tablets,
        COUNT(DISTINCT CASE WHEN t.last_sync >= ${cutoff} THEN t.id END)::int AS online,
        COUNT(m.id)::int AS plays
      FROM tablets t
      LEFT JOIN metrics m ON m.tablet_id = t.id
      GROUP BY COALESCE(t.zone, 'Sin zona')
      ORDER BY plays DESC
    `;
    res.json(rows.map((r) => ({
      zone: r.zone,
      tablets: Number(r.tablets),
      online: Number(r.online),
      plays: Number(r.plays),
    })));
  } catch (err) { next(err); }
});

// GET /api/stats/ads-no-plays — active approved ads with zero plays (#13)
router.get('/ads-no-plays', async (req, res, next) => {
  try {
    const ads = await prisma.ad.findMany({
      where: { active: true, deletedAt: null, approvalStatus: 'approved', metrics: { none: {} } },
      select: {
        id: true, name: true, type: true, durationS: true, createdAt: true,
        campaign: { select: { id: true, name: true, active: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(ads);
  } catch (err) { next(err); }
});

module.exports = router;
