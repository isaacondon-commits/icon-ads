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
    const notes = await prisma.adminNote.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(notes);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { body } = z.object({ body: z.string().min(1) }).parse(req.body);
    const note = await prisma.adminNote.create({
      data: { body, authorName: req.user?.name ?? 'Admin' },
    });
    res.status(201).json(note);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.adminNote.delete({ where: { id: Number(req.params.id) } });
    res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Note not found' });
    next(err);
  }
});

module.exports = router;
