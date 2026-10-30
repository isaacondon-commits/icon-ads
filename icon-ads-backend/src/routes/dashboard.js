const router = require('express').Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/dashboard/summary — all dashboard data in one round-trip (#21)
router.get('/summary', async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const inSevenDays = new Date(today);
    inSevenDays.setDate(inSevenDays.getDate() + 7);

    const [
      tabletList,
      clientCount,
      playlistCount,
      adCount,
      totalPlays,
      dailyRows7,
      clientRows,
      expiringAds,
      dailyRows30,
      auditLogs,
    ] = await Promise.all([
      prisma.tablet.findMany({
        include: { playlist: { select: { id: true, name: true } } },
        orderBy: { name: 'asc' },
      }),
      prisma.client.count({ where: { active: true, deletedAt: null } }),
      prisma.playlist.count({ where: { active: true } }),
      prisma.ad.count({ where: { active: true, deletedAt: null } }),
      prisma.metric.count(),
      prisma.$queryRaw`
        SELECT DATE(played_at AT TIME ZONE 'UTC') AS date, COUNT(*)::int AS count
        FROM metrics WHERE played_at >= ${sevenDaysAgo}
        GROUP BY DATE(played_at AT TIME ZONE 'UTC') ORDER BY date ASC
      `,
      prisma.$queryRaw`
        SELECT c.id AS "clientId", c.name AS "clientName", COUNT(m.id)::int AS count
        FROM metrics m JOIN ads a ON a.id = m.ad_id JOIN clients c ON c.id = a.client_id
        GROUP BY c.id, c.name ORDER BY count DESC LIMIT 10
      `,
      prisma.ad.findMany({
        where: { active: true, deletedAt: null, endsAt: { lte: inSevenDays, gte: today } },
        include: { client: { select: { name: true } } },
        orderBy: { endsAt: 'asc' },
      }),
      prisma.$queryRaw`
        SELECT DATE(played_at AT TIME ZONE 'UTC') AS date, COUNT(*)::int AS count
        FROM metrics WHERE played_at >= ${thirtyDaysAgo}
        GROUP BY DATE(played_at AT TIME ZONE 'UTC') ORDER BY date ASC
      `,
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
    ]);

    const now = Date.now();
    const onlineThreshold = 10 * 60000;

    // Monitor data
    const metricsToday = await prisma.metric.groupBy({
      by: ['tabletId'],
      where: { playedAt: { gte: today } },
      _count: { id: true },
    });
    const countMap = Object.fromEntries(metricsToday.map((r) => [r.tabletId, r._count.id]));

    const monitor = tabletList.map((t) => {
      const diffMin = t.lastSync ? (now - new Date(t.lastSync).getTime()) / 60000 : Infinity;
      return {
        id: t.id, name: t.name, deviceId: t.deviceId, zone: t.zone, timezone: t.timezone,
        status: diffMin < 10 ? 'online' : 'offline',
        offlineMinutes: Math.floor(diffMin),
        lastSync: t.lastSync,
        playlist: t.playlist ? { id: t.playlist.id, name: t.playlist.name } : null,
        todayPlays: countMap[t.id] ?? 0,
      };
    });

    const onlineCount = tabletList.filter(
      (t) => t.lastSync && now - new Date(t.lastSync).getTime() < onlineThreshold
    ).length;

    // 7-day daily plays with zero-fill
    const dayMap7 = Object.fromEntries(dailyRows7.map((r) => [String(r.date).slice(0, 10), Number(r.count)]));
    const dailyPlays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      return { date: key, count: dayMap7[key] ?? 0 };
    });

    // 30-day trend
    const dayMap30 = Object.fromEntries(dailyRows30.map((r) => [String(r.date).slice(0, 10), Number(r.count)]));
    const trend30d = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(thirtyDaysAgo);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      return { date: key, count: dayMap30[key] ?? 0 };
    });

    res.json({
      stats: {
        tablets: { total: tabletList.length, online: onlineCount },
        clients: clientCount,
        playlists: playlistCount,
        ads: adCount,
        totalPlays,
        dailyPlays,
        playsByClient: clientRows.map((r) => ({
          clientId: Number(r.clientId),
          clientName: r.clientName,
          count: Number(r.count),
        })),
        expiringAds: expiringAds.map((a) => ({
          id: a.id, name: a.name, clientName: a.client?.name ?? '—',
          endsAt: a.endsAt,
          daysLeft: Math.ceil((new Date(a.endsAt).getTime() - Date.now()) / 86400000),
        })),
      },
      monitor,
      trend30d,
      recentActivity: auditLogs,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
