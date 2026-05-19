const router = require('express').Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');
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

// GET /api/logs/audit/export — CSV download of full audit trail (#43)
router.get('/audit/export', requireAdmin, async (req, res, next) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 90 * 86400000);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const logs = await prisma.auditLog.findMany({
      where: { createdAt: { gte: from, lte: to } },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10000,
    });
    const header = 'id,fecha,accion,entidad,entidad_id,detalle,usuario,email,ip';
    const rows = logs.map((l) =>
      [
        l.id,
        l.createdAt.toISOString(),
        l.action,
        l.entity,
        l.entityId ?? '',
        `"${(l.details ?? '').replace(/"/g, '""')}"`,
        `"${(l.user?.name ?? '').replace(/"/g, '""')}"`,
        l.user?.email ?? '',
        l.ip ?? '',
      ].join(',')
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send([header, ...rows].join('\n'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
