const router = require('express').Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

// GET /api/reminders
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const reminders = await prisma.reminder.findMany({
      orderBy: [{ done: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
    });
    res.json(reminders);
  } catch (err) { next(err); }
});

// POST /api/reminders
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { title, body, dueAt } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const reminder = await prisma.reminder.create({
      data: { title, body: body || null, dueAt: dueAt ? new Date(dueAt) : null },
    });
    res.status(201).json(reminder);
  } catch (err) { next(err); }
});

// PATCH /api/reminders/:id
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const { done, title, body, dueAt } = req.body;
    const data = {};
    if (done !== undefined) data.done = done;
    if (title !== undefined) data.title = title;
    if (body !== undefined) data.body = body;
    if (dueAt !== undefined) data.dueAt = dueAt ? new Date(dueAt) : null;
    const reminder = await prisma.reminder.update({
      where: { id: Number(req.params.id) },
      data,
    });
    res.json(reminder);
  } catch (err) { next(err); }
});

// DELETE /api/reminders/:id
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    await prisma.reminder.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
