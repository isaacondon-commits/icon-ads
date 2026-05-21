const router = require('express').Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const [zones, tablets] = await Promise.all([
      prisma.zone.findMany({ orderBy: { name: 'asc' } }),
      prisma.tablet.findMany({ select: { zone: true } }),
    ]);
    const result = zones.map((z) => ({
      ...z,
      tabletCount: tablets.filter((t) => t.zone === z.name).length,
    }));
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, description, polygon, color } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const zone = await prisma.zone.create({
      data: { name, description: description || null, polygon: polygon ?? [], color: color || '#3b82f6' },
    });
    res.status(201).json(zone);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Zone name already exists' });
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { name, description, polygon, color } = req.body;
    const zone = await prisma.zone.update({
      where: { id: Number(req.params.id) },
      data: { name, description: description ?? null, polygon, color },
    });
    res.json(zone);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.zone.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
