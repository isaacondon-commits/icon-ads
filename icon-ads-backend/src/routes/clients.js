const router = require('express').Router();
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { audit } = require('../lib/auditLog');
const pdf = require('../lib/pdfHelper');

router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid id' });
  next();
});

// A client's campaigns = ones they bill (clientId) OR are tagged on as an
// additional client (#multi-client) — used everywhere a client's own page
// lists "their" campaigns.
const campaignsForClientWhere = (id) => ({
  deletedAt: null,
  OR: [{ clientId: id }, { additionalClients: { some: { clientId: id } } }],
});

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

router.get('/', async (req, res, next) => {
  try {
    const clients = await prisma.client.findMany({
      where: { deletedAt: null },
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
    const client = await prisma.client.create({ data });
    await audit(req, 'CREATE', 'client', client.id, `Created "${client.name}"`);
    res.status(201).json(client);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// GET /:id/proposal — proposal PDF (#32)
router.get('/:id/proposal', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [client, campaigns, metricsAgg] = await Promise.all([
      prisma.client.findUnique({ where: { id, deletedAt: null } }),
      prisma.campaign.findMany({ where: campaignsForClientWhere(id), orderBy: { startDate: 'desc' } }),
      prisma.metric.groupBy({ by: ['campaignId'], where: { campaign: campaignsForClientWhere(id) }, _count: { id: true } }),
    ]);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const playMap = Object.fromEntries(metricsAgg.map((r) => [r.campaignId, r._count.id]));

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

    pdf.sectionTitle(doc, 'Resumen de campañas');
    const totalPlays = Object.values(playMap).reduce((s, v) => s + v, 0);
    const activeCampaigns = campaigns.filter((c) => c.active).length;
    pdf.row(doc, 'Campañas activas', activeCampaigns);
    pdf.row(doc, 'Total campañas', campaigns.length);
    pdf.row(doc, 'Total reproducciones', totalPlays.toLocaleString('es-AR'), true);

    if (campaigns.length > 0) {
      pdf.sectionTitle(doc, 'Detalle de campañas');
      for (const c of campaigns.slice(0, 20)) {
        const plays = playMap[c.id] ?? 0;
        const revenue = c.cpm ? (plays / 1000) * c.cpm : null;
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica-Bold').fillColor(pdf.BLACK).text(c.name, 50);
        doc.fontSize(9).font('Helvetica').fillColor(pdf.GRAY)
          .text(`${pdf.fmtDate(c.startDate)} – ${pdf.fmtDate(c.endDate)}  ·  ${plays.toLocaleString()} reproducciones${c.cpm ? `  ·  CPM $${c.cpm}` : ''}${revenue ? `  ·  Ingreso est. $${revenue.toFixed(2)}` : ''}`, 50);
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

// GET /:id — full profile with campaigns + metrics aggregate (#8)
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [client, campaigns, metricsAgg] = await Promise.all([
      prisma.client.findUnique({ where: { id, deletedAt: null } }),
      prisma.campaign.findMany({
        where: campaignsForClientWhere(id),
        include: {
          client: { select: { id: true, name: true } },
          additionalClients: { include: { client: { select: { id: true, name: true } } } },
          ads: { where: { deletedAt: null } },
          _count: { select: { metrics: true } },
        },
        orderBy: { startDate: 'desc' },
      }),
      prisma.metric.groupBy({
        by: ['campaignId'],
        where: { campaign: campaignsForClientWhere(id) },
        _count: { id: true },
        _sum: { durationPlayedS: true },
      }),
    ]);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const aggMap = Object.fromEntries(
      metricsAgg.map((r) => [r.campaignId, { plays: r._count.id, totalSeconds: r._sum.durationPlayedS ?? 0 }])
    );
    const campaignsWithStats = campaigns.map((c) => ({ ...c, stats: aggMap[c.id] ?? { plays: 0, totalSeconds: 0 } }));
    res.json({ ...client, campaigns: campaignsWithStats });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const data = clientSchema.partial().parse(req.body);
    const client = await prisma.client.update({ where: { id: Number(req.params.id), deletedAt: null }, data });
    await audit(req, 'UPDATE', 'client', client.id, `Updated "${client.name}"`);
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
    const client = await prisma.client.update({
      where: { id: Number(req.params.id), deletedAt: null },
      data: { active: false, deletedAt: new Date() },
    });
    await audit(req, 'DELETE', 'client', client.id, `Deleted "${client.name}"`);
    res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Client not found' });
    next(err);
  }
});

// PATCH /:id/reactivate (#34)
router.patch('/:id/reactivate', requireAdmin, async (req, res, next) => {
  try {
    const client = await prisma.client.update({ where: { id: Number(req.params.id) }, data: { active: true, deletedAt: null } });
    await audit(req, 'REACTIVATE', 'client', client.id, `Reactivated "${client.name}"`);
    res.json(client);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Client not found' });
    next(err);
  }
});

module.exports = router;
