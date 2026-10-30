// Maestro: valores que el admin define y se aplican solos en el sistema.
// Por ahora, la duración máxima de los anuncios que suben las empresas desde
// su portal (general + excepción por empresa). Ver lib/portalLimits.js.

const router = require('express').Router();
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { audit } = require('../lib/auditLog');
const { KEY, MIN_S, MAX_S, defaultMaxSeconds } = require('../lib/portalLimits');

router.use(requireAuth);

async function snapshot() {
  const [defaultSeconds, clients] = await Promise.all([
    defaultMaxSeconds(),
    prisma.client.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, active: true, portalMaxAdSeconds: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  return {
    minSeconds: MIN_S, maxSeconds: MAX_S, defaultSeconds,
    clients: clients.map((c) => ({ id: c.id, name: c.name, active: c.active, maxSeconds: c.portalMaxAdSeconds })),
  };
}

router.get('/ad-duration', async (req, res, next) => {
  try { res.json(await snapshot()); } catch (err) { next(err); }
});

const seconds = z.number().int().min(MIN_S, `Mínimo ${MIN_S} segundos.`).max(MAX_S, `Máximo ${MAX_S} segundos.`);

// defaultSeconds: el general. clients: [{ id, maxSeconds }] con null = usar el general.
router.put('/ad-duration', requireAdmin, async (req, res, next) => {
  try {
    const parsed = z.object({
      defaultSeconds: seconds.optional(),
      clients: z.array(z.object({ id: z.number().int().positive(), maxSeconds: seconds.nullable() })).max(1000).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Datos inválidos.' });
    const { defaultSeconds, clients = [] } = parsed.data;

    await prisma.$transaction([
      ...(defaultSeconds !== undefined
        ? [prisma.systemConfig.upsert({ where: { key: KEY }, update: { value: String(defaultSeconds) }, create: { key: KEY, value: String(defaultSeconds) } })]
        : []),
      ...clients.map((c) => prisma.client.updateMany({ where: { id: c.id, deletedAt: null }, data: { portalMaxAdSeconds: c.maxSeconds } })),
    ]);
    const parts = [];
    if (defaultSeconds !== undefined) parts.push(`general=${defaultSeconds}s`);
    for (const c of clients) parts.push(`cliente ${c.id}=${c.maxSeconds ?? 'general'}`);
    if (parts.length) await audit(req, 'UPDATE_CONFIG', 'system', null, `Duración máxima portal: ${parts.join(', ')}`);
    res.json(await snapshot());
  } catch (err) { next(err); }
});

module.exports = router;
