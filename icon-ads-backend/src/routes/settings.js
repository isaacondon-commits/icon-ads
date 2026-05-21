const router = require('express').Router();
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { audit } = require('../lib/auditLog');

router.use(requireAuth);

const ALLOWED_KEYS = [
  'maintenance_mode', 'metrics_retention_days', 'webhook_url',
  'ga_measurement_id',
  'callmebot_phone', 'callmebot_apikey',
  'auto_archive_expired',
];

// GET /api/settings — all system config values
router.get('/', async (req, res, next) => {
  try {
    const configs = await prisma.systemConfig.findMany();
    const result = {};
    for (const c of configs) result[c.key] = c.value;
    res.json(result);
  } catch (err) { next(err); }
});

// PUT /api/settings/:key
router.put('/:key', requireAdmin, async (req, res, next) => {
  try {
    const key = req.params.key;
    if (!ALLOWED_KEYS.includes(key)) return res.status(400).json({ error: 'Clave no permitida' });
    const { value } = z.object({ value: z.string() }).parse(req.body);
    const config = await prisma.systemConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    await audit(req, 'UPDATE_CONFIG', 'system', null, `${key}=${value}`);
    res.json(config);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

module.exports = router;
