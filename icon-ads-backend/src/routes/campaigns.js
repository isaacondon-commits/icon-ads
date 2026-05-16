const router = require('express').Router();
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

const campaignSchema = z.object({
  clientId: z.number().int().positive(),
  name: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

router.get('/', async (req, res, next) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      include: { client: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(campaigns);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { clientId, name, startDate, endDate } = campaignSchema.parse(req.body);
    const campaign = await prisma.campaign.create({
      data: { clientId, name, startDate: new Date(startDate), endDate: new Date(endDate) },
      include: { client: { select: { id: true, name: true } } },
    });
    res.status(201).json(campaign);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        client: { select: { id: true, name: true } },
        ads: true,
      },
    });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json(campaign);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const body = campaignSchema.partial().parse(req.body);
    const data = { ...body };
    if (body.startDate) data.startDate = new Date(body.startDate);
    if (body.endDate) data.endDate = new Date(body.endDate);
    const campaign = await prisma.campaign.update({
      where: { id: Number(req.params.id) },
      data,
    });
    res.json(campaign);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Campaign not found' });
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.campaign.update({
      where: { id: Number(req.params.id) },
      data: { active: false },
    });
    res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Campaign not found' });
    next(err);
  }
});

module.exports = router;
