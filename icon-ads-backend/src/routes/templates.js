const router = require('express').Router();
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid id' });
  next();
});

const templateSchema = z.object({
  name: z.string().min(1),
  cpm: z.number().positive().nullable().optional(),
  maxImpressions: z.number().int().positive().nullable().optional(),
  budget: z.number().positive().nullable().optional(),
  targetImpressions: z.number().int().positive().nullable().optional(),
  observations: z.string().nullable().optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const templates = await prisma.campaignTemplate.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(templates);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const d = templateSchema.parse(req.body);
    const template = await prisma.campaignTemplate.create({
      data: {
        name: d.name,
        cpm: d.cpm ?? null,
        maxImpressions: d.maxImpressions ?? null,
        budget: d.budget ?? null,
        targetImpressions: d.targetImpressions ?? null,
        observations: d.observations ?? null,
      },
    });
    res.status(201).json(template);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.campaignTemplate.delete({ where: { id: Number(req.params.id) } });
    res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Template not found' });
    next(err);
  }
});

module.exports = router;
