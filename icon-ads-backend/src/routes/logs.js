const router = require('express').Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const syslog = require('../lib/systemLog');

router.use(requireAuth);

// GET /api/logs — in-memory system events (last 100)
router.get('/', (req, res) => {
  res.json(syslog.getEvents());
});

// GET /api/logs/audit — DB audit trail (last 200, paginated)
router.get('/audit', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      prisma.auditLog.count(),
    ]);
    res.json({ logs, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
