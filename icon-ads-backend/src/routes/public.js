const router = require('express').Router();
const prisma = require('../lib/prisma');

async function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'API key required. Pass X-API-Key header.' });
  try {
    const apiKey = await prisma.apiKey.findUnique({ where: { key } });
    if (!apiKey || !apiKey.active) return res.status(403).json({ error: 'Invalid or revoked API key.' });
    prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsed: new Date() } }).catch(() => {});
    next();
  } catch (err) { next(err); }
}

router.use(requireApiKey);

// GET /api/v1/public/stats
router.get('/stats', async (req, res, next) => {
  try {
    const [totalPlays, tabletCount, activeAds, activeClients] = await Promise.all([
      prisma.metric.count(),
      prisma.tablet.count(),
      prisma.ad.count({ where: { active: true, deletedAt: null, approvalStatus: 'approved' } }),
      prisma.client.count({ where: { active: true, deletedAt: null } }),
    ]);
    res.json({ totalPlays, tabletCount, activeAds, activeClients, timestamp: new Date().toISOString() });
  } catch (err) { next(err); }
});

// GET /api/v1/public/zones
router.get('/zones', async (req, res, next) => {
  try {
    const tablets = await prisma.tablet.findMany({ select: { zone: true } });
    const map = {};
    for (const t of tablets) {
      const z = t.zone || 'Sin zona';
      map[z] = (map[z] || 0) + 1;
    }
    const zones = Object.entries(map)
      .map(([zone, tabletCount]) => ({ zone, tabletCount }))
      .sort((a, b) => b.tabletCount - a.tabletCount);
    res.json(zones);
  } catch (err) { next(err); }
});


module.exports = router;
