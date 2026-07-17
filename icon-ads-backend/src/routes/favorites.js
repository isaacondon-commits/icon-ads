const router = require('express').Router();
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid id' });
  next();
});

router.get('/', async (req, res, next) => {
  try {
    const where = req.query.type ? { entityType: String(req.query.type) } : {};
    const favorites = await prisma.favorite.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json(favorites);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { entityType, entityId } = z.object({
      entityType: z.string().min(1),
      entityId: z.number().int().positive(),
    }).parse(req.body);
    const fav = await prisma.favorite.upsert({
      where: { entityType_entityId: { entityType, entityId } },
      create: { entityType, entityId },
      update: {},
    });
    res.status(201).json(fav);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.favorite.delete({ where: { id: Number(req.params.id) } });
    res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Favorite not found' });
    next(err);
  }
});

module.exports = router;
