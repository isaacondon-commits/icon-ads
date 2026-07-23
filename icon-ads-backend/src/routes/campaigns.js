const router = require('express').Router();
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../lib/auditLog');
const { bumpPlaylistsForCampaignId } = require('../lib/bumpPlaylists');
const pdf = require('../lib/pdfHelper');

router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid id' });
  next();
});

const campaignSchema = z.object({
  clientId: z.number().int().positive(),
  name: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  cpm: z.number().positive().nullable().optional(),
  maxImpressions: z.number().int().positive().nullable().optional(),
  budget: z.number().positive().nullable().optional(),
  observations: z.string().nullable().optional(),
  targetImpressions: z.number().int().positive().nullable().optional(),
  // Extra clients tied to the campaign besides the billing client (#multi-client).
  // Contract/certificate/payment-link PDFs keep using clientId only.
  additionalClientIds: z.array(z.number().int().positive()).optional(),
});

const CAMPAIGN_CLIENT_INCLUDE = {
  client: { select: { id: true, name: true } },
  additionalClients: { include: { client: { select: { id: true, name: true } } } },
};

// additionalClientIds always excludes the billing clientId itself and any
// duplicates, since that relationship is already expressed by clientId.
function dedupeAdditionalClientIds(additionalClientIds, clientId) {
  return [...new Set(additionalClientIds ?? [])].filter((id) => id !== clientId);
}

// POST /archive-expired — manually archive all campaigns past their end date (#4)
router.post('/archive-expired', async (req, res, next) => {
  try {
    const now = new Date();
    const result = await prisma.campaign.updateMany({
      where: { endDate: { lt: now }, deletedAt: null },
      data: { active: false, deletedAt: now },
    });
    res.json({ archived: result.count });
  } catch (err) { next(err); }
});

// GET /archived — soft-deleted campaigns (#5)
router.get('/archived', async (req, res, next) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { NOT: { deletedAt: null } },
      include: {
        ...CAMPAIGN_CLIENT_INCLUDE,
        _count: { select: { ads: true } },
      },
      orderBy: { deletedAt: 'desc' },
    });
    res.json(campaigns);
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { deletedAt: null },
      include: {
        ...CAMPAIGN_CLIENT_INCLUDE,
        _count: { select: { metrics: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(campaigns);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { clientId, name, startDate, endDate, cpm, maxImpressions, budget, observations, targetImpressions, additionalClientIds } = campaignSchema.parse(req.body);
    const extraClientIds = dedupeAdditionalClientIds(additionalClientIds, clientId);
    const campaign = await prisma.campaign.create({
      data: {
        clientId, name, startDate: new Date(startDate), endDate: new Date(endDate),
        cpm: cpm ?? null, maxImpressions: maxImpressions ?? null, budget: budget ?? null,
        observations: observations ?? null, targetImpressions: targetImpressions ?? null,
        additionalClients: { create: extraClientIds.map((id) => ({ clientId: id })) },
      },
      include: CAMPAIGN_CLIENT_INCLUDE,
    });
    await audit(req, 'CREATE', 'campaign', campaign.id, `Created "${campaign.name}"`);
    res.status(201).json(campaign);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// GET /:id/certificate — verified plays certificate PDF (#51)
router.get('/:id/certificate', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [campaign, playCount, playsPerDay] = await Promise.all([
      prisma.campaign.findUnique({ where: { id }, include: { client: true } }),
      prisma.metric.count({ where: { campaignId: id } }),
      prisma.$queryRaw`
        SELECT DATE(played_at AT TIME ZONE 'UTC') AS date, COUNT(*)::int AS count
        FROM metrics WHERE campaign_id = ${id}
        GROUP BY DATE(played_at AT TIME ZONE 'UTC') ORDER BY date ASC LIMIT 30
      `,
    ]);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const doc = pdf.createDoc();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="certificado_${id}.pdf"`);

    pdf.header(doc, 'Certificado de campaña', 'Reproducciones verificadas por ICON ADS');

    pdf.sectionTitle(doc, 'Datos de la campaña');
    pdf.row(doc, 'Campaña', campaign.name);
    pdf.row(doc, 'Cliente', campaign.client?.name ?? '—');
    pdf.row(doc, 'Período', `${pdf.fmtDate(campaign.startDate)} al ${pdf.fmtDate(campaign.endDate)}`);
    if (campaign.cpm) pdf.row(doc, 'CPM acordado', `$${campaign.cpm}`);
    if (campaign.budget) pdf.row(doc, 'Presupuesto', `$${campaign.budget}`);

    pdf.sectionTitle(doc, 'Reproducciones verificadas');
    pdf.row(doc, 'Total de reproducciones', playCount.toLocaleString('es-AR'), true);
    if (campaign.cpm) pdf.row(doc, 'Ingreso estimado', `$${((playCount / 1000) * campaign.cpm).toFixed(2)}`, true);
    if (campaign.targetImpressions) {
      const pct = Math.round((playCount / campaign.targetImpressions) * 100);
      pdf.row(doc, 'Meta de impresiones', campaign.targetImpressions.toLocaleString('es-AR'));
      pdf.row(doc, 'Cumplimiento', `${pct}%`, true);
    }

    pdf.sectionTitle(doc, 'Certificación');
    doc.fontSize(10).font('Helvetica').fillColor(pdf.BLACK)
      .text(`ICON ADS certifica que la campaña "${campaign.name}" del cliente "${campaign.client?.name}" registró ${playCount.toLocaleString('es-AR')} reproducciones verificadas en el sistema entre el ${pdf.fmtDate(campaign.startDate)} y el ${pdf.fmtDate(campaign.endDate)}.`, 50, doc.y, { width: doc.page.width - 100, lineGap: 4 });
    doc.moveDown(0.5);
    doc.text(`Los datos son registrados en tiempo real desde las tablets instaladas en la flota de taxis. Este documento fue generado el ${pdf.fmtDate(new Date())}.`, 50, doc.y, { width: doc.page.width - 100, lineGap: 4 });

    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(250, doc.y).strokeColor('#111827').stroke();
    doc.fontSize(8).fillColor(pdf.GRAY).text('Firma autorizada — ICON ADS', 50, doc.y + 4);

    pdf.footer(doc);
    doc.pipe(res);
    doc.end();
  } catch (err) { next(err); }
});

// GET /:id/contract — digital contract PDF (#56)
router.get('/:id/contract', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const campaign = await prisma.campaign.findUnique({ where: { id }, include: { client: true } });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const doc = pdf.createDoc();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="contrato_${id}.pdf"`);

    pdf.header(doc, 'Contrato de servicios publicitarios', 'ICON ADS · Publicidad digital en taxi');

    pdf.sectionTitle(doc, 'Las partes');
    pdf.row(doc, 'Prestador', 'ICON ADS S.A.S. — Montevideo, Uruguay');
    pdf.row(doc, 'Cliente', campaign.client?.name ?? '—');
    if (campaign.client?.company) pdf.row(doc, 'Empresa', campaign.client.company);
    if (campaign.client?.rut) pdf.row(doc, 'RUT', campaign.client.rut);
    if (campaign.client?.email) pdf.row(doc, 'Email', campaign.client.email);
    if (campaign.client?.address) pdf.row(doc, 'Dirección', campaign.client.address);

    pdf.sectionTitle(doc, 'Objeto del contrato');
    pdf.row(doc, 'Campaña', campaign.name);
    pdf.row(doc, 'Inicio', pdf.fmtDate(campaign.startDate));
    pdf.row(doc, 'Fin', pdf.fmtDate(campaign.endDate));
    if (campaign.cpm) pdf.row(doc, 'CPM (USD/1000 impresiones)', `$${campaign.cpm}`);
    if (campaign.budget) pdf.row(doc, 'Presupuesto total', `$${campaign.budget}`);
    if (campaign.maxImpressions) pdf.row(doc, 'Máximo de impresiones', campaign.maxImpressions.toLocaleString('es-AR'));
    if (campaign.targetImpressions) pdf.row(doc, 'Meta de impresiones', campaign.targetImpressions.toLocaleString('es-AR'));
    if (campaign.observations) pdf.row(doc, 'Observaciones', campaign.observations);

    pdf.sectionTitle(doc, 'Condiciones generales');
    const clauses = [
      '1. ICON ADS se compromete a distribuir el contenido publicitario del Cliente en las tablets instaladas en la flota de taxis activa durante el período pactado.',
      '2. El Cliente declara que el material publicitario entregado cumple con la normativa vigente y no infringe derechos de terceros.',
      '3. La facturación se realizará en base a las reproducciones efectivas registradas en el sistema, al CPM acordado.',
      '4. Cualquier modificación al presente contrato deberá ser acordada por escrito entre ambas partes.',
      '5. La jurisdicción para dirimir cualquier controversia será la de los tribunales de Montevideo, Uruguay.',
    ];
    doc.moveDown(0.3);
    for (const c of clauses) {
      doc.fontSize(9).font('Helvetica').fillColor(pdf.BLACK).text(c, 50, doc.y, { width: doc.page.width - 100, lineGap: 3 });
      doc.moveDown(0.4);
    }

    doc.moveDown(1.5);
    const sigY = doc.y;
    doc.moveTo(50, sigY).lineTo(220, sigY).strokeColor('#111827').stroke();
    doc.moveTo(330, sigY).lineTo(500, sigY).strokeColor('#111827').stroke();
    doc.fontSize(8).fillColor(pdf.GRAY).text('ICON ADS S.A.S.', 50, sigY + 4);
    doc.text(campaign.client?.name ?? 'Cliente', 330, sigY + 4);
    doc.fontSize(8).text(`Fecha: ${pdf.fmtDate(new Date())}`, 50, sigY + 16);
    doc.text(`Fecha: ___/___/______`, 330, sigY + 16);

    pdf.footer(doc);
    doc.pipe(res);
    doc.end();
  } catch (err) { next(err); }
});

// GET /:id — with ads, metrics summary, comments (#8, #18)
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [campaign, playsPerDay, comments] = await Promise.all([
      prisma.campaign.findUnique({
        where: { id, deletedAt: null },
        include: {
          ...CAMPAIGN_CLIENT_INCLUDE,
          ads: { where: { deletedAt: null } },
          _count: { select: { metrics: true } },
        },
      }),
      prisma.$queryRaw`
        SELECT DATE(played_at AT TIME ZONE 'UTC') AS date, COUNT(*)::int AS count
        FROM metrics WHERE campaign_id = ${id}
        GROUP BY DATE(played_at AT TIME ZONE 'UTC')
        ORDER BY date DESC LIMIT 30
      `,
      prisma.comment.findMany({
        where: { campaignId: id },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ ...campaign, playsPerDay, comments });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const body = campaignSchema.partial().parse(req.body);
    const { additionalClientIds, ...rest } = body;
    const data = { ...rest };
    if (body.startDate) data.startDate = new Date(body.startDate);
    if (body.endDate) data.endDate = new Date(body.endDate);
    if ('budget' in body) data.budget = body.budget ?? null;
    if ('observations' in body) data.observations = body.observations ?? null;
    if ('targetImpressions' in body) data.targetImpressions = body.targetImpressions ?? null;

    const id = Number(req.params.id);
    let campaign;
    if (additionalClientIds !== undefined) {
      const existing = await prisma.campaign.findUnique({ where: { id, deletedAt: null }, select: { clientId: true } });
      if (!existing) return res.status(404).json({ error: 'Campaign not found' });
      const billingClientId = body.clientId ?? existing.clientId;
      const extraClientIds = dedupeAdditionalClientIds(additionalClientIds, billingClientId);
      [, campaign] = await prisma.$transaction([
        prisma.campaignClient.deleteMany({ where: { campaignId: id, clientId: { notIn: extraClientIds } } }),
        prisma.campaign.update({
          where: { id, deletedAt: null },
          data: {
            ...data,
            additionalClients: {
              upsert: extraClientIds.map((clientId) => ({
                where: { campaignId_clientId: { campaignId: id, clientId } },
                create: { clientId },
                update: {},
              })),
            },
          },
          include: CAMPAIGN_CLIENT_INCLUDE,
        }),
      ]);
    } else {
      campaign = await prisma.campaign.update({ where: { id, deletedAt: null }, data, include: CAMPAIGN_CLIENT_INCLUDE });
    }
    await audit(req, 'UPDATE', 'campaign', campaign.id, `Updated "${campaign.name}"`);
    res.json(campaign);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Campaign not found' });
    next(err);
  }
});

// DELETE — soft delete (#33)
router.delete('/:id', async (req, res, next) => {
  try {
    const campaign = await prisma.campaign.update({
      where: { id: Number(req.params.id), deletedAt: null },
      data: { active: false, deletedAt: new Date() },
    });
    await audit(req, 'DELETE', 'campaign', campaign.id, `Deleted "${campaign.name}"`);
    await bumpPlaylistsForCampaignId(campaign.id);
    res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Campaign not found' });
    next(err);
  }
});

// PATCH /:id/reactivate (#34)
router.patch('/:id/reactivate', async (req, res, next) => {
  try {
    const campaign = await prisma.campaign.update({ where: { id: Number(req.params.id) }, data: { active: true, deletedAt: null } });
    await audit(req, 'REACTIVATE', 'campaign', campaign.id, `Reactivated "${campaign.name}"`);
    res.json(campaign);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Campaign not found' });
    next(err);
  }
});

// PATCH /:id/pause — pause campaign (#15)
router.patch('/:id/pause', async (req, res, next) => {
  try {
    const campaign = await prisma.campaign.update({ where: { id: Number(req.params.id) }, data: { active: false } });
    await audit(req, 'PAUSE', 'campaign', campaign.id, `Paused "${campaign.name}"`);
    await bumpPlaylistsForCampaignId(campaign.id);
    res.json(campaign);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Campaign not found' });
    next(err);
  }
});

// PATCH /:id/resume — resume campaign (#15) + validate has approved ads (#25)
router.patch('/:id/resume', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const approvedAds = await prisma.ad.count({
      where: { campaignId: id, active: true, deletedAt: null, approvalStatus: 'approved' },
    });
    if (approvedAds === 0) {
      return res.status(400).json({ error: 'La campaña no tiene anuncios aprobados. Agregá al menos un anuncio antes de activarla.' });
    }
    const campaign = await prisma.campaign.update({ where: { id }, data: { active: true } });
    await audit(req, 'RESUME', 'campaign', campaign.id, `Resumed "${campaign.name}"`);
    res.json(campaign);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Campaign not found' });
    next(err);
  }
});

// POST /:id/clone — clone campaign with all its ads (#9)
router.post('/:id/clone', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const original = await prisma.campaign.findUnique({
      where: { id, deletedAt: null },
      include: {
        ads: { where: { deletedAt: null, active: true } },
        additionalClients: true,
      },
    });
    if (!original) return res.status(404).json({ error: 'Campaign not found' });
    const clone = await prisma.campaign.create({
      data: {
        clientId: original.clientId,
        name: `${original.name} (copia)`,
        startDate: original.startDate,
        endDate: original.endDate,
        cpm: original.cpm,
        maxImpressions: original.maxImpressions,
        active: false,
        additionalClients: { create: original.additionalClients.map((ac) => ({ clientId: ac.clientId })) },
        ads: {
          create: original.ads.map((ad) => ({
            name: ad.name,
            type: ad.type,
            fileUrl: ad.fileUrl,
            filename: ad.filename,
            durationS: ad.durationS,
            active: ad.active,
            approvalStatus: ad.approvalStatus,
            priority: ad.priority,
            targetUrl: ad.targetUrl ?? null,
            startsAt: ad.startsAt ?? null,
            endsAt: ad.endsAt ?? null,
          })),
        },
      },
      include: { ...CAMPAIGN_CLIENT_INCLUDE, _count: { select: { metrics: true } } },
    });
    await audit(req, 'CLONE', 'campaign', clone.id, `Clonada de campaña #${id} "${original.name}"`);
    res.status(201).json(clone);
  } catch (err) {
    next(err);
  }
});

// PATCH /:id/transfer — transfer campaign to another client (#18)
router.patch('/:id/transfer', async (req, res, next) => {
  try {
    const { clientId } = z.object({ clientId: z.number().int().positive() }).parse(req.body);
    const id = Number(req.params.id);
    // The new billing client can't also sit in additionalClients — drop it
    // there if present, since clientId already expresses that relationship.
    await prisma.campaignClient.deleteMany({ where: { campaignId: id, clientId } });
    const campaign = await prisma.campaign.update({
      where: { id, deletedAt: null },
      data: { clientId },
      include: CAMPAIGN_CLIENT_INCLUDE,
    });
    await audit(req, 'TRANSFER', 'campaign', campaign.id, `Transferida al cliente #${clientId} "${campaign.client.name}"`);
    res.json(campaign);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Campaign not found' });
    next(err);
  }
});

// POST /:id/comments — add comment (#18)
router.post('/:id/comments', async (req, res, next) => {
  try {
    const { body } = z.object({ body: z.string().min(1) }).parse(req.body);
    const comment = await prisma.comment.create({
      data: {
        campaignId: Number(req.params.id),
        userId: req.user?.id ?? null,
        authorName: req.user?.name ?? 'Admin',
        body,
      },
    });
    res.status(201).json(comment);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// POST /:id/payment-link — Mercado Pago checkout preference (#54)
router.post('/:id/payment-link', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const campaign = await prisma.campaign.findUnique({
      where: { id, deletedAt: null },
      include: { client: { select: { name: true, email: true } } },
    });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (!campaign.budget) return res.status(400).json({ error: 'La campaña no tiene presupuesto definido.' });
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken) return res.status(503).json({ error: 'MERCADOPAGO_ACCESS_TOKEN no configurado en el servidor.' });
    const body = {
      items: [{
        title: `ICON ADS — ${campaign.name}`,
        description: `Campaña publicitaria del ${new Date(campaign.startDate).toLocaleDateString('es-UY')} al ${new Date(campaign.endDate).toLocaleDateString('es-UY')}`,
        unit_price: campaign.budget,
        quantity: 1,
        currency_id: 'UYU',
      }],
      external_reference: `campaign_${id}`,
      ...(campaign.client?.email ? { payer: { email: campaign.client.email } } : {}),
    };
    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
    if (!mpRes.ok) {
      const errData = await mpRes.json().catch(() => ({}));
      return res.status(502).json({ error: `Mercado Pago: ${errData.message ?? mpRes.statusText}` });
    }
    const data = await mpRes.json();
    await audit(req, 'PAYMENT_LINK', 'campaign', id, `MP preferenceId=${data.id}`);
    res.json({ initPoint: data.init_point, sandboxInitPoint: data.sandbox_init_point, preferenceId: data.id });
  } catch (err) { next(err); }
});

module.exports = router;
