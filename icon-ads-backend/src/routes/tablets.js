const router = require('express').Router();
const { z } = require('zod');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

const tabletSchema = z.object({
  deviceId: z.string().min(1),
  name: z.string().min(1),
  zone: z.string().optional(),
  playlistId: z.number().int().positive().nullable().optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const tablets = await prisma.tablet.findMany({
      include: { playlist: { select: { id: true, name: true, version: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(tablets);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { deviceId, name, zone, playlistId } = tabletSchema.parse(req.body);
    const token = crypto.randomBytes(32).toString('hex');
    const tablet = await prisma.tablet.create({
      data: { deviceId, name, zone, playlistId, token },
    });
    res.status(201).json(tablet);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.code === 'P2002') return res.status(409).json({ error: 'Device ID already registered' });
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const tablet = await prisma.tablet.findUnique({
      where: { id: Number(req.params.id) },
      include: { playlist: true },
    });
    if (!tablet) return res.status(404).json({ error: 'Tablet not found' });
    res.json(tablet);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const data = tabletSchema.partial().parse(req.body);
    const tablet = await prisma.tablet.update({
      where: { id: Number(req.params.id) },
      data,
    });
    res.json(tablet);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Tablet not found' });
    next(err);
  }
});

module.exports = router;
