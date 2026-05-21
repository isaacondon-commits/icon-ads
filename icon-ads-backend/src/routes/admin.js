const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
const PptxGenJS = require('pptxgenjs');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

// POST /api/admin/seed — creates the first superadmin if no users exist
router.post('/seed', async (req, res, next) => {
  try {
    const count = await prisma.user.count();
    if (count > 0) return res.status(409).json({ message: 'Already seeded', users: count });

    const email = req.body.email || 'admin@iconads.com';
    const password = req.body.password || 'iconads2024';
    const name = req.body.name || 'Administrador';

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, password: hashed, name, role: 'superadmin' },
    });
    res.status(201).json({ message: 'Admin created', email: user.email });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/dashboard-stats — full system summary with alerts
router.get('/dashboard-stats', requireAuth, async (req, res, next) => {
  try {
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const onlineThreshold = new Date(now.getTime() - 10 * 60 * 1000);

    const [tablets, clients, campaigns, ads, totalPlays, pendingAds] = await Promise.all([
      prisma.tablet.findMany({
        select: { id: true, name: true, zone: true, lastSync: true, status: true },
      }),
      prisma.client.count({ where: { active: true, deletedAt: null } }),
      prisma.campaign.count({ where: { active: true, deletedAt: null } }),
      prisma.ad.count({ where: { active: true, deletedAt: null } }),
      prisma.metric.count(),
      prisma.ad.count({ where: { approvalStatus: 'pending', deletedAt: null } }),
    ]);

    const totalTablets = tablets.length;
    const onlineTablets = tablets.filter(
      (t) => t.lastSync && new Date(t.lastSync) >= onlineThreshold
    ).length;
    const offlineTablets = totalTablets - onlineTablets;
    const syncedToday = tablets.filter(
      (t) => t.lastSync && new Date(t.lastSync) >= todayStart
    ).length;
    const syncedYesterday = tablets.filter(
      (t) => t.lastSync && new Date(t.lastSync) >= yesterdayStart && new Date(t.lastSync) < todayStart
    ).length;
    const offlinePct = totalTablets > 0 ? Math.round((offlineTablets / totalTablets) * 100) : 0;

    res.json({
      tablets: {
        total: totalTablets,
        online: onlineTablets,
        offline: offlineTablets,
        offlinePct,
        syncedToday,
        syncedYesterday,
      },
      alerts: {
        massOffline: offlinePct > 20,
        massOfflineMsg: offlinePct > 20
          ? `${offlinePct}% de las tablets están offline (${offlineTablets}/${totalTablets})`
          : null,
        pendingAds: pendingAds > 0 ? `${pendingAds} anuncio(s) pendiente(s) de aprobación` : null,
      },
      counts: { clients, campaigns, ads, totalPlays, pendingAds },
      generatedAt: now.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/export/tablets — CSV export (#22)
router.get('/export/tablets', requireAuth, async (req, res, next) => {
  try {
    const tablets = await prisma.tablet.findMany({
      include: { playlist: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    const now = Date.now();
    const header = 'id,name,deviceId,zone,timezone,status,playlist,lastSync,notes,maintenanceUntil,createdAt';
    const rows = tablets.map((t) => {
      const isOnline = t.lastSync && (now - new Date(t.lastSync).getTime()) < 10 * 60000;
      return [
        t.id,
        `"${(t.name || '').replace(/"/g, '""')}"`,
        t.deviceId,
        `"${(t.zone || '').replace(/"/g, '""')}"`,
        t.timezone || '',
        isOnline ? 'online' : 'offline',
        `"${(t.playlist?.name || '').replace(/"/g, '""')}"`,
        t.lastSync ? new Date(t.lastSync).toISOString() : '',
        `"${(t.notes || '').replace(/"/g, '""')}"`,
        t.maintenanceUntil ? new Date(t.maintenanceUntil).toISOString() : '',
        new Date(t.createdAt).toISOString(),
      ].join(',');
    });
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tablets_${date}.csv"`);
    res.send([header, ...rows].join('\n'));
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/stats/zones — plays and tablet count grouped by zone (#24)
router.get('/stats/zones', requireAuth, async (req, res, next) => {
  try {
    const tablets = await prisma.tablet.findMany({
      select: { id: true, zone: true, lastSync: true },
    });
    const now = Date.now();
    const onlineThreshold = now - 10 * 60 * 1000;

    const zoneMap = {};
    for (const t of tablets) {
      const z = t.zone || 'Sin zona';
      if (!zoneMap[z]) zoneMap[z] = { zone: z, tablets: 0, online: 0, plays: 0 };
      zoneMap[z].tablets++;
      if (t.lastSync && new Date(t.lastSync).getTime() > onlineThreshold) zoneMap[z].online++;
    }

    const playsRows = await prisma.$queryRaw`
      SELECT COALESCE(t.zone, 'Sin zona') AS zone, COUNT(m.id)::int AS plays
      FROM metrics m
      JOIN tablets t ON m.tablet_id = t.id
      GROUP BY t.zone
    `;

    for (const row of playsRows) {
      const z = row.zone;
      if (zoneMap[z]) zoneMap[z].plays = Number(row.plays);
    }

    res.json(Object.values(zoneMap).sort((a, b) => b.tablets - a.tablets));
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/backup — full JSON export of key data (#42)
router.get('/backup', requireAuth, async (req, res, next) => {
  try {
    const [clients, campaigns, ads, playlists, tablets] = await Promise.all([
      prisma.client.findMany({ where: { deletedAt: null } }),
      prisma.campaign.findMany({ where: { deletedAt: null } }),
      prisma.ad.findMany({
        where: { deletedAt: null },
        select: { id: true, campaignId: true, name: true, type: true, filename: true, durationS: true, active: true, approvalStatus: true, priority: true, tags: true, createdAt: true, updatedAt: true },
      }),
      prisma.playlist.findMany({ include: { playlistAds: { select: { adId: true, order: true } } } }),
      prisma.tablet.findMany({
        select: { id: true, deviceId: true, name: true, zone: true, status: true, lastSync: true, appVersion: true, osVersion: true, deviceModel: true, batteryLevel: true, createdAt: true },
      }),
    ]);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="iconads_backup_${date}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      version: '1.0',
      counts: { clients: clients.length, campaigns: campaigns.length, ads: ads.length, playlists: playlists.length, tablets: tablets.length },
      data: { clients, campaigns, ads, playlists, tablets },
    });
  } catch (err) { next(err); }
});

// GET /api/admin/export/excel — multi-sheet XLSX export (#64)
router.get('/export/excel', requireAuth, async (req, res, next) => {
  try {
    const [clients, campaigns, ads, tablets] = await Promise.all([
      prisma.client.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
      prisma.campaign.findMany({ where: { deletedAt: null }, include: { client: { select: { name: true } } }, orderBy: { name: 'asc' } }),
      prisma.ad.findMany({
        where: { deletedAt: null },
        include: { campaign: { select: { name: true } } },
        orderBy: { name: 'asc' },
      }),
      prisma.tablet.findMany({ orderBy: { name: 'asc' } }),
    ]);

    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(clients.map((c) => ({
      ID: c.id, Nombre: c.name, Email: c.email, Empresa: c.company ?? '', Teléfono: c.phone ?? '',
      RUT: c.rut ?? '', Dirección: c.address ?? '', Activo: c.active ? 'Sí' : 'No',
      Creado: new Date(c.createdAt).toISOString().slice(0, 10),
    }))), 'Clientes');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(campaigns.map((c) => ({
      ID: c.id, Nombre: c.name, Cliente: c.client?.name ?? '', Inicio: c.startDate ? new Date(c.startDate).toISOString().slice(0, 10) : '',
      Fin: c.endDate ? new Date(c.endDate).toISOString().slice(0, 10) : '',
      CPM: c.cpm ?? '', Presupuesto: c.budget ?? '', Activa: c.active ? 'Sí' : 'No',
    }))), 'Campañas');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ads.map((a) => ({
      ID: a.id, Nombre: a.name, Tipo: a.type, Campaña: a.campaign?.name ?? '',
      Duración: a.durationS, Prioridad: a.priority, Estado: a.approvalStatus,
      Activo: a.active ? 'Sí' : 'No', Creado: new Date(a.createdAt).toISOString().slice(0, 10),
    }))), 'Anuncios');

    const now = Date.now();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tablets.map((t) => ({
      ID: t.id, Nombre: t.name, Zona: t.zone ?? '', DeviceID: t.deviceId,
      Modelo: t.deviceModel ?? '', Android: t.osVersion ?? '', AppVersion: t.appVersion ?? '',
      Batería: t.batteryLevel ?? '', Estado: t.lastSync && (now - new Date(t.lastSync).getTime()) < 10 * 60000 ? 'online' : 'offline',
      ÚltimoSync: t.lastSync ? new Date(t.lastSync).toISOString() : '',
    }))), 'Tablets');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="iconads_${date}.xlsx"`);
    res.send(buf);
  } catch (err) { next(err); }
});

// GET /api/admin/export/pptx — PowerPoint metrics export (#40)
router.get('/export/pptx', requireAuth, async (req, res, next) => {
  try {
    const [totalPlays, tabletCount, clientCount, campaignCount, weeklyRows, topCampaigns] = await Promise.all([
      prisma.metric.count(),
      prisma.tablet.count(),
      prisma.client.count({ where: { active: true, deletedAt: null } }),
      prisma.campaign.count({ where: { active: true, deletedAt: null } }),
      prisma.$queryRaw`
        SELECT TO_CHAR(DATE_TRUNC('week', played_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS week, COUNT(*)::int AS count
        FROM metrics WHERE played_at >= NOW() - INTERVAL '8 weeks'
        GROUP BY DATE_TRUNC('week', played_at AT TIME ZONE 'UTC') ORDER BY week ASC
      `,
      prisma.$queryRaw`
        SELECT c.name, COUNT(m.id)::int AS plays
        FROM metrics m JOIN campaigns c ON m.campaign_id = c.id
        GROUP BY c.id, c.name ORDER BY plays DESC LIMIT 5
      `,
    ]);

    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';
    pptx.title = 'ICON ADS — Reporte de métricas';

    // Slide 1 — Cover
    const s1 = pptx.addSlide();
    s1.background = { color: '1d4ed8' };
    s1.addText('ICON ADS', { x: 0.5, y: 1.5, w: 9, h: 1, fontSize: 40, bold: true, color: 'FFFFFF', align: 'center' });
    s1.addText('Reporte de métricas publicitarias', { x: 0.5, y: 2.7, w: 9, h: 0.6, fontSize: 20, color: 'BFDBFE', align: 'center' });
    s1.addText(`Generado: ${new Date().toLocaleDateString('es-AR')}`, { x: 0.5, y: 3.5, w: 9, h: 0.4, fontSize: 14, color: 'BFDBFE', align: 'center' });

    // Slide 2 — KPIs
    const s2 = pptx.addSlide();
    s2.addText('Resumen ejecutivo', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 24, bold: true, color: '111827' });
    const kpis = [
      { label: 'Reproducciones totales', value: totalPlays.toLocaleString('es-AR') },
      { label: 'Tablets activas', value: String(tabletCount) },
      { label: 'Clientes activos', value: String(clientCount) },
      { label: 'Campañas activas', value: String(campaignCount) },
    ];
    kpis.forEach((k, i) => {
      const x = (i % 2) * 4.8 + 0.3;
      const y = Math.floor(i / 2) * 2.2 + 1.2;
      s2.addShape(pptx.ShapeType.rect, { x, y, w: 4.3, h: 1.8, fill: { color: 'EFF6FF' }, line: { color: 'BFDBFE', width: 1 } });
      s2.addText(k.value, { x, y: y + 0.2, w: 4.3, h: 0.8, fontSize: 28, bold: true, color: '1d4ed8', align: 'center' });
      s2.addText(k.label, { x, y: y + 1.0, w: 4.3, h: 0.5, fontSize: 11, color: '6B7280', align: 'center' });
    });

    // Slide 3 — Top campaigns
    if (topCampaigns.length > 0) {
      const s3 = pptx.addSlide();
      s3.addText('Top 5 campañas por reproducciones', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 24, bold: true, color: '111827' });
      const maxPlays = Math.max(...topCampaigns.map((c) => Number(c.plays)), 1);
      topCampaigns.forEach((c, i) => {
        const y = 1.2 + i * 0.8;
        const barW = (Number(c.plays) / maxPlays) * 7;
        s3.addText(String(c.name).slice(0, 30), { x: 0.3, y, w: 3, h: 0.5, fontSize: 11, color: '111827' });
        s3.addShape(pptx.ShapeType.rect, { x: 3.5, y: y + 0.1, w: barW, h: 0.35, fill: { color: '3b82f6' } });
        s3.addText(Number(c.plays).toLocaleString(), { x: 3.6 + barW, y, w: 1.5, h: 0.5, fontSize: 10, color: '374151' });
      });
    }

    // Slide 4 — Weekly trend
    if (weeklyRows.length > 0) {
      const s4 = pptx.addSlide();
      s4.addText('Tendencia semanal (últimas 8 semanas)', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 24, bold: true, color: '111827' });
      const maxW = Math.max(...weeklyRows.map((r) => Number(r.count)), 1);
      const colW = 8.5 / weeklyRows.length;
      weeklyRows.forEach((r, i) => {
        const barH = (Number(r.count) / maxW) * 3;
        const x = 0.5 + i * colW;
        const y = 4.5 - barH;
        s4.addShape(pptx.ShapeType.rect, { x, y, w: colW - 0.1, h: barH, fill: { color: '3b82f6' } });
        s4.addText(Number(r.count) > 0 ? Number(r.count).toLocaleString() : '', { x, y: y - 0.4, w: colW, h: 0.35, fontSize: 8, color: '374151', align: 'center' });
        s4.addText(String(r.week).slice(5), { x, y: 4.6, w: colW, h: 0.3, fontSize: 8, color: '6B7280', align: 'center' });
      });
    }

    const buf = await pptx.write({ outputType: 'nodebuffer' });
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="iconads_metricas_${date}.pptx"`);
    res.send(buf);
  } catch (err) { next(err); }
});

// POST /api/admin/demo-seed — seed demo data for testing (#63)
router.post('/demo-seed', requireAuth, async (req, res, next) => {
  try {
    const existing = await prisma.client.findFirst({ where: { email: 'demo@iconads.com' } });
    if (existing) return res.status(409).json({ message: 'Demo data already seeded', clientId: existing.id });

    const demoClient = await prisma.client.create({
      data: {
        name: 'Cliente Demo',
        email: 'demo@iconads.com',
        company: 'Empresa Demo S.A.',
        phone: '+598 99 000 000',
        active: true,
      },
    });

    const now = new Date();
    const start = new Date(now); start.setDate(start.getDate() - 30);
    const end = new Date(now); end.setDate(end.getDate() + 60);

    const campaign = await prisma.campaign.create({
      data: {
        clientId: demoClient.id,
        name: 'Campaña demo — Lanzamiento',
        startDate: start,
        endDate: end,
        cpm: 5,
        budget: 500,
        targetImpressions: 100000,
        observations: 'Campaña de ejemplo generada automáticamente.',
        active: true,
      },
    });

    res.status(201).json({
      message: 'Demo data seeded',
      client: { id: demoClient.id, name: demoClient.name },
      campaign: { id: campaign.id, name: campaign.name },
    });
  } catch (err) { next(err); }
});

// GET /api/admin/api-keys — list public API keys (#70)
router.get('/api-keys', requireAuth, async (req, res, next) => {
  try {
    const keys = await prisma.apiKey.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(keys.map((k) => ({ ...k, key: k.key.slice(0, 14) + '...' })));
  } catch (err) { next(err); }
});

// POST /api/admin/api-keys — create a new API key (#70)
router.post('/api-keys', requireAuth, async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const key = 'ICADS-' + crypto.randomBytes(20).toString('hex').toUpperCase();
    const apiKey = await prisma.apiKey.create({ data: { name, key } });
    res.status(201).json(apiKey);
  } catch (err) { next(err); }
});

// DELETE /api/admin/api-keys/:id — revoke an API key (#70)
router.delete('/api-keys/:id', requireAuth, async (req, res, next) => {
  try {
    await prisma.apiKey.update({ where: { id: Number(req.params.id) }, data: { active: false } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
