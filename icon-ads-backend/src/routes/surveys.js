const router = require('express').Router();
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET / — list all surveys with answer count
router.get('/', async (req, res, next) => {
  try {
    const surveys = await prisma.$queryRaw`
      SELECT s.id, s.question, s.options, s.active, s.created_at,
             COUNT(a.id)::int AS answer_count
      FROM surveys s
      LEFT JOIN survey_answers a ON a.survey_id = s.id
      GROUP BY s.id ORDER BY s.created_at DESC
    `;
    res.json(surveys);
  } catch (err) { next(err); }
});

// POST / — create survey
router.post('/', async (req, res, next) => {
  try {
    const { question, options } = z.object({
      question: z.string().min(1),
      options: z.array(z.string().min(1)).min(2).max(4),
    }).parse(req.body);
    const [survey] = await prisma.$queryRaw`
      INSERT INTO surveys (question, options, active, created_at)
      VALUES (${question}, ${JSON.stringify(options)}::jsonb, true, NOW())
      RETURNING *
    `;
    res.status(201).json(survey);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// PATCH /:id/toggle — toggle active
router.patch('/:id/toggle', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [updated] = await prisma.$queryRaw`
      UPDATE surveys SET active = NOT active WHERE id = ${id} RETURNING *
    `;
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /:id
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.$executeRaw`DELETE FROM surveys WHERE id = ${id}`;
    res.status(204).send();
  } catch (err) { next(err); }
});

// GET /:id/results — answer breakdown
router.get('/:id/results', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [survey] = await prisma.$queryRaw`SELECT * FROM surveys WHERE id = ${id}`;
    if (!survey) return res.status(404).json({ error: 'Not found' });
    const answers = await prisma.$queryRaw`
      SELECT option_index, COUNT(*)::int AS count
      FROM survey_answers WHERE survey_id = ${id}
      GROUP BY option_index ORDER BY option_index
    `;
    res.json({ survey, answers });
  } catch (err) { next(err); }
});

module.exports = router;
