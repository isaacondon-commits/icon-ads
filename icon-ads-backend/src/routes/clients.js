const router = require('express').Router();
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { audit } = require('../lib/auditLog');
const pdf = require('../lib/pdfHelper');
const { inviteClient, revokeClient } = require('../lib/portalInvite');
const { bumpPlaylistsForAdIds } = require('../lib/bumpPlaylists');

router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid id' });
  next();
});

// Anuncios de una empresa + sus reproducciones (y segundos al aire).
async function clientAdsWithStats(id) {
  const [ads, agg] = await Promise.all([
    prisma.ad.findMany({ where: { clientId: id, deletedAt: null }, orderBy: { createdAt: 'desc' } }),
    prisma.metric.groupBy({
      by: ['adId'],
      where: { ad: { clientId: id } },
      _count: { id: true },
      _sum: { durationPlayedS: true },
    }),
  ]);
  const map = Object.fromEntries(agg.map((r) => [r.adId, { plays: r._count.id, totalSeconds: r._sum.durationPlayedS ?? 0 }]));
  return ads.map((a) => ({ ...a, stats: map[a.id] ?? { plays: 0, totalSeconds: 0 } }));
}

const clientSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  company: z.string().optional(),
  rut: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
});

// El email es único en la tabla, pero los clientes borrados (soft delete)
// siguen ahí con el suyo. Para poder dar de alta otra vez ese email, el
// cliente borrado pasa a un email "archivado" y su acceso al portal (ya
// cortado) se elimina. Si el email lo tiene un cliente vigente, devuelve su nombre.
async function freeEmail(email, exceptId) {
  const holders = await prisma.client.findMany({
    where: { email: { equals: email, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, name: true, deletedAt: true },
  });
  for (const c of holders) {
    if (!c.deletedAt) return c.name;
    await prisma.clientUser.deleteMany({ where: { clientId: c.id } });
    await prisma.client.update({ where: { id: c.id }, data: { email: `archivado-${c.id}-${Date.now()}+${email}` } });
  }
  // También puede quedar un acceso al portal huérfano con ese email.
  await prisma.clientUser.deleteMany({
    where: { email: email.trim().toLowerCase(), client: { deletedAt: { not: null } } },
  });
  return null;
}

const emailTaken = (name) => ({ error: `Ya existe un cliente con ese email (${name}).` });

// Estados de una empresa:
//  - activa:      active=true,  deletedAt=null
//  - pausada:     active=false, deletedAt=null -> sus anuncios no salen en las
//                 tablets; el portal sigue abierto (ve sus estadísticas).
//  - desactivada: deletedAt != null -> anuncios fuera del aire y portal cortado.
// Cada cambio sube la versión de las playlists con anuncios de la empresa, así
// las tablets re-descargan sin ellos (o con ellos de vuelta).
const STATE_ACTIONS = {
  pause:      { where: { active: true, deletedAt: null }, data: { active: false }, audit: 'PAUSE', label: 'pausada' },
  resume:     { where: { active: false, deletedAt: null }, data: { active: true }, audit: 'RESUME', label: 'reanudada' },
  deactivate: { where: { deletedAt: null }, data: { active: false }, audit: 'DELETE', label: 'desactivada' },
  reactivate: { where: { NOT: { deletedAt: null } }, data: { active: true, deletedAt: null }, audit: 'REACTIVATE', label: 'reactivada' },
};

async function setClientsState(req, ids, action) {
  const spec = STATE_ACTIONS[action];
  const targets = await prisma.client.findMany({ where: { id: { in: ids }, ...spec.where }, select: { id: true, name: true } });
  if (!targets.length) return [];
  const targetIds = targets.map((c) => c.id);
  const data = action === 'deactivate' ? { ...spec.data, deletedAt: new Date() } : spec.data;
  await prisma.client.updateMany({ where: { id: { in: targetIds } }, data });
  if (action === 'deactivate') for (const id of targetIds) await revokeClient(id);
  // Al reactivar vuelve el acceso al portal que tenía (tiene que volver a entrar).
  if (action === 'reactivate') {
    await prisma.clientUser.updateMany({ where: { clientId: { in: targetIds }, passwordHash: { not: null } }, data: { active: true } });
  }
  const ads = await prisma.ad.findMany({ where: { clientId: { in: targetIds }, deletedAt: null }, select: { id: true } });
  await bumpPlaylistsForAdIds(ads.map((a) => a.id));
  for (const c of targets) await audit(req, spec.audit, 'client', c.id, `"${c.name}" ${spec.label}`);
  return targetIds;
}

// GET /?all=1 incluye las desactivadas (pantalla Clientes); sin eso, sólo las
// vigentes (activas y pausadas), que es lo que usan los selectores.
router.get('/', async (req, res, next) => {
  try {
    const clients = await prisma.client.findMany({
      where: req.query.all === '1' ? {} : { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    res.json(clients);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const data = clientSchema.parse(req.body);
    const holder = await freeEmail(data.email);
    if (holder) return res.status(409).json(emailTaken(holder));
    const client = await prisma.client.create({ data });
    await audit(req, 'CREATE', 'client', client.id, `Created "${client.name}"`);
    // Toda empresa nueva recibe su invitación al portal de estadísticas.
    let portalInvite;
    try {
      portalInvite = await inviteClient(client);
      await audit(req, 'PORTAL_INVITE', 'client', client.id, portalInvite.sent ? `Invitación al portal enviada a ${client.email}` : `Invitación al portal NO enviada: ${portalInvite.error}`);
    } catch (err) {
      portalInvite = { sent: false, error: err.message };
    }
    res.status(201).json({ ...client, portalInvite });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// POST /bulk — { ids, action: pause | resume | deactivate | reactivate }
router.post('/bulk', requireAdmin, async (req, res, next) => {
  try {
    const parsed = z.object({
      ids: z.array(z.number().int().positive()).min(1).max(500),
      action: z.enum(Object.keys(STATE_ACTIONS)),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Datos inválidos.' });
    const changed = await setClientsState(req, [...new Set(parsed.data.ids)], parsed.data.action);
    res.json({ changed: changed.length, ids: changed });
  } catch (err) { next(err); }
});

// GET /:id/proposal — proposal PDF (#32)
router.get('/:id/proposal', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [client, ads] = await Promise.all([
      prisma.client.findUnique({ where: { id, deletedAt: null } }),
      clientAdsWithStats(id),
    ]);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const doc = pdf.createDoc();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="propuesta_${client.name.replace(/\s+/g, '_')}.pdf"`);

    pdf.header(doc, 'Propuesta comercial', `Preparada para ${client.company || client.name} · ${pdf.fmtDate(new Date())}`);

    pdf.sectionTitle(doc, 'Datos del cliente');
    pdf.row(doc, 'Nombre', client.name);
    if (client.company) pdf.row(doc, 'Empresa', client.company);
    if (client.rut) pdf.row(doc, 'RUT', client.rut);
    pdf.row(doc, 'Email', client.email);
    if (client.phone) pdf.row(doc, 'Teléfono', client.phone);
    if (client.address) pdf.row(doc, 'Dirección', client.address);

    pdf.sectionTitle(doc, 'Resumen de anuncios');
    const totalPlays = ads.reduce((n, a) => n + a.stats.plays, 0);
    pdf.row(doc, 'Anuncios activos', ads.filter((a) => a.active && a.approvalStatus === 'approved').length);
    pdf.row(doc, 'Total anuncios', ads.length);
    pdf.row(doc, 'Total reproducciones', totalPlays.toLocaleString('es-AR'), true);

    if (ads.length > 0) {
      pdf.sectionTitle(doc, 'Detalle de anuncios');
      for (const a of ads.slice(0, 20)) {
        const window = a.startsAt || a.endsAt ? `${a.startsAt ? pdf.fmtDate(a.startsAt) : '…'} – ${a.endsAt ? pdf.fmtDate(a.endsAt) : '…'}  ·  ` : '';
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica-Bold').fillColor(pdf.BLACK).text(a.publicName || a.name, 50);
        doc.fontSize(9).font('Helvetica').fillColor(pdf.GRAY)
          .text(`${window}${a.stats.plays.toLocaleString('es-AR')} reproducciones`, 50);
      }
    }

    pdf.sectionTitle(doc, 'Propuesta de contratación');
    doc.fontSize(10).font('Helvetica').fillColor(pdf.BLACK)
      .text('ICON ADS ofrece publicidad digital en tablets instaladas en taxis de Montevideo, con alcance masivo, segmentación por zona y métricas verificadas en tiempo real.', 50, doc.y, { width: doc.page.width - 100, lineGap: 4 });
    doc.moveDown(0.5);
    doc.text('Para coordinar una reunión comercial o iniciar una campaña, contactarse con el equipo de ventas de ICON ADS.', 50, doc.y, { width: doc.page.width - 100, lineGap: 4 });

    pdf.footer(doc);
    doc.pipe(res);
    doc.end();
  } catch (err) { next(err); }
});

// GET /:id — perfil con sus anuncios + reproducciones de cada uno (#8)
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [client, ads] = await Promise.all([
      prisma.client.findUnique({ where: { id, deletedAt: null } }),
      clientAdsWithStats(id),
    ]);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json({ ...client, ads });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const data = clientSchema.partial().parse(req.body);
    const before = data.email ? await prisma.client.findUnique({ where: { id: Number(req.params.id) }, select: { email: true } }) : null;
    if (before && before.email.toLowerCase() !== data.email.toLowerCase()) {
      const holder = await freeEmail(data.email, Number(req.params.id));
      if (holder) return res.status(409).json(emailTaken(holder));
    }
    const client = await prisma.client.update({ where: { id: Number(req.params.id), deletedAt: null }, data });
    await audit(req, 'UPDATE', 'client', client.id, `Updated "${client.name}"`);
    // Cambió el email: es el usuario del portal. Se actualiza, se cierran las
    // sesiones y se anulan los enlaces que hayan ido al email anterior.
    if (before && before.email !== client.email) {
      await prisma.clientUser.updateMany({
        where: { clientId: client.id },
        data: {
          email: client.email.trim().toLowerCase(), sessionVersion: { increment: 1 },
          inviteTokenHash: null, inviteExpiresAt: null, resetTokenHash: null, resetExpiresAt: null,
        },
      }).catch((err) => console.warn('[clients] email del portal:', err.message));
    }
    res.json(client);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Client not found' });
    next(err);
  }
});

// DELETE — soft delete (#33)
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const changed = await setClientsState(req, [Number(req.params.id)], 'deactivate');
    if (!changed.length) return res.status(404).json({ error: 'Client not found' });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ── Acceso al portal de estadísticas ────────────────────────────────────────

// GET /:id/portal — estado del acceso + últimos ingresos
router.get('/:id/portal', requireAdmin, async (req, res, next) => {
  try {
    const cu = await prisma.clientUser.findUnique({ where: { clientId: Number(req.params.id) } });
    if (!cu) return res.json({ exists: false });
    const events = await prisma.auditLog.findMany({
      where: { entity: 'client_user', entityId: cu.id },
      orderBy: { createdAt: 'desc' }, take: 15,
      select: { action: true, ip: true, createdAt: true },
    });
    res.json({
      exists: true, email: cu.email, active: cu.active, activated: !!cu.passwordHash,
      invitedAt: cu.invitedAt, inviteExpiresAt: cu.inviteTokenHash ? cu.inviteExpiresAt : null,
      lastLoginAt: cu.lastLoginAt, lastLoginIp: cu.lastLoginIp,
      lockedUntil: cu.lockedUntil && cu.lockedUntil > new Date() ? cu.lockedUntil : null,
      events,
    });
  } catch (err) { next(err); }
});

// POST /:id/portal/invite — manda (o reenvía) la invitación
router.post('/:id/portal/invite', requireAdmin, async (req, res, next) => {
  try {
    const client = await prisma.client.findFirst({ where: { id: Number(req.params.id), deletedAt: null } });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const r = await inviteClient(client);
    await audit(req, 'PORTAL_INVITE', 'client', client.id, r.sent ? `Invitación al portal enviada a ${client.email}` : `Invitación al portal NO enviada: ${r.error}`);
    res.status(r.sent ? 200 : 502).json(r);
  } catch (err) { next(err); }
});

// POST /:id/portal/revoke — corta el acceso y cierra sus sesiones al instante
router.post('/:id/portal/revoke', requireAdmin, async (req, res, next) => {
  try {
    const done = await revokeClient(Number(req.params.id));
    if (!done) return res.status(404).json({ error: 'La empresa no tiene acceso al portal' });
    await audit(req, 'PORTAL_REVOKE', 'client', Number(req.params.id), 'Acceso al portal cortado');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PATCH /:id/reactivate (#34)
router.patch('/:id/reactivate', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await setClientsState(req, [id], 'reactivate');
    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json(client);
  } catch (err) { next(err); }
});

module.exports = router;
