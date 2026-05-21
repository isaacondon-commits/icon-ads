const router = require('express').Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/abtests
router.get('/', async (req, res, next) => {
  try {
    const tests = await prisma.abTest.findMany({
      include: {
        adA: { select: { id: true, name: true, type: true } },
        adB: { select: { id: true, name: true, type: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Enrich with play counts per group
    const enriched = await Promise.all(tests.map(async (t) => {
      const [playsA, playsB, tabletsA, tabletsB] = await Promise.all([
        prisma.metric.count({ where: { adId: t.adAId } }),
        prisma.metric.count({ where: { adId: t.adBId } }),
        prisma.tablet.count({ where: { abGroup: 'A' } }),
        prisma.tablet.count({ where: { abGroup: 'B' } }),
      ]);
      return { ...t, playsA, playsB, tabletsA, tabletsB };
    }));

    res.json(enriched);
  } catch (err) { next(err); }
});

// POST /api/abtests
router.post('/', async (req, res, next) => {
  try {
    const { name, adAId, adBId } = req.body;
    if (!name || !adAId || !adBId) return res.status(400).json({ error: 'name, adAId, adBId required' });
    if (adAId === adBId) return res.status(400).json({ error: 'adAId and adBId must be different' });

    // Assign tablets to A/B groups (50/50 split by ID parity)
    const tablets = await prisma.tablet.findMany({ select: { id: true } });
    await Promise.all(tablets.map((t) =>
      prisma.tablet.update({ where: { id: t.id }, data: { abGroup: t.id % 2 === 0 ? 'A' : 'B' } })
    ));

    const test = await prisma.abTest.create({
      data: { name, adAId: Number(adAId), adBId: Number(adBId), status: 'active' },
      include: {
        adA: { select: { id: true, name: true } },
        adB: { select: { id: true, name: true } },
      },
    });
    res.status(201).json({ ...test, tabletsAssigned: tablets.length });
  } catch (err) { next(err); }
});

// PATCH /api/abtests/:id/status
router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['active', 'paused', 'finished'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const test = await prisma.abTest.update({ where: { id: Number(req.params.id) }, data: { status } });
    res.json(test);
  } catch (err) { next(err); }
});

// DELETE /api/abtests/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.abTest.delete({ where: { id: Number(req.params.id) } });
    // Clear tablet ab groups
    await prisma.tablet.updateMany({ data: { abGroup: null } });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
