const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
const PptxGenJS = require('pptxgenjs');
const multer = require('multer');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const apiKeyOrAuth = require('../middleware/apiKeyOrAuth');
const { audit } = require('../lib/auditLog');
const supabaseStorage = require('../lib/supabase-storage');
const firebaseAdmin = require('../lib/firebase-admin');
const forceApkFlags = require('../lib/forceApkFlags');
const forceSyncFlags = require('../lib/forceSyncFlags');
const screenshotFlags = require('../lib/screenshotFlags');

const apkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid id' });
  next();
});

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

// DELETE /api/admin/tablet/:id — borra una fila de tablet (limpieza de orfanas).
router.delete('/tablet/:id', apiKeyOrAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const t = await prisma.tablet.findUnique({ where: { id } });
    if (!t) return res.status(404).json({ error: 'No existe' });
    await prisma.tablet.delete({ where: { id } });
    await audit(req, 'DELETE', 'tablet', id, `Borrada "${t.name}" (deviceId=${t.deviceId})`);
    res.json({ ok: true, deleted: { id, name: t.name } });
  } catch (err) {
    if (err.code === 'P2003') return res.status(409).json({ error: 'Tiene datos relacionados' });
    next(err);
  }
});

// POST /api/admin/rename-tablets  { prefix?: 'Taxi', digits?: 2 }
// Renombra, ordenadas por id, todas las tablets que ya reportaron una versión
// de app (las reales) a "<prefix> NN". Deja las que nunca sincronizaron.
router.post('/rename-tablets', apiKeyOrAuth, async (req, res, next) => {
  try {
    const prefix = (req.body?.prefix || 'Taxi').trim();
    const digits = Math.min(Math.max(Number(req.body?.digits) || 2, 1), 4);
    const tablets = await prisma.tablet.findMany({
      where: { appVersion: { not: null } },
      orderBy: { id: 'asc' },
      select: { id: true, name: true },
    });
    const mapping = [];
    for (let i = 0; i < tablets.length; i++) {
      const newName = `${prefix} ${String(i + 1).padStart(digits, '0')}`;
      if (tablets[i].name !== newName) {
        await prisma.tablet.update({ where: { id: tablets[i].id }, data: { name: newName } });
      }
      mapping.push({ id: tablets[i].id, from: tablets[i].name, to: newName });
    }
    await audit(req, 'RENAME_TABLETS', 'tablet', null, `${mapping.length} renombradas a "${prefix} NN"`);
    res.json({ ok: true, renamed: mapping.length, mapping });
  } catch (err) { next(err); }
});

// POST /api/admin/tablet/:id/request-screenshot — pide una captura ya.
// La tablet la sube en su próximo /sync (≤10s en modo test, o instantáneo con FCM).
router.post('/tablet/:id/request-screenshot', apiKeyOrAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const tablet = await prisma.tablet.findUnique({ where: { id }, select: { id: true, fcmToken: true } });
    if (!tablet) return res.status(404).json({ error: 'No existe' });
    // NO se manda push FCM: el push despierta al SyncWorker, no a la Activity,
    // y ésta es la única que puede sacar la captura. La Activity la agarra en
    // su loop de sync (≤10s en modo test, ≤30s normal).
    screenshotFlags.add(id);
    res.json({ ok: true, message: 'Pedida — la tablet la manda en su próximo sync (unos segundos).' });
  } catch (err) { next(err); }
});

// POST /api/admin/tablet/:id/block  { on: true|false }
// Bloquea/desbloquea una tablet (manualStatus). Bloqueada = frena la
// reproducción y muestra pantalla neutra, pero sigue sincronizando.
router.post('/tablet/:id/block', apiKeyOrAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const on = req.body?.on === true || req.body?.on === 'true' || req.body?.on === 1;
    const tablet = await prisma.tablet.findUnique({ where: { id }, select: { id: true, name: true, fcmToken: true } });
    if (!tablet) return res.status(404).json({ error: 'No existe' });
    await prisma.tablet.update({ where: { id }, data: { manualStatus: on ? 'bloqueada' : 'activa' } });
    forceSyncFlags.add(id);
    let pushed = 0;
    if (tablet.fcmToken) {
      try { const r = await firebaseAdmin.sendSyncPush([tablet.fcmToken]); pushed = r?.successCount || 0; } catch { /* best-effort */ }
    }
    await audit(req, on ? 'TABLET_BLOCK' : 'TABLET_UNBLOCK', 'tablet', id, tablet.name);
    res.json({ ok: true, manualStatus: on ? 'bloqueada' : 'activa', pushed,
      message: on ? `"${tablet.name}" bloqueada.` : `"${tablet.name}" desbloqueada.` });
  } catch (err) { next(err); }
});

// POST /api/admin/tablet/:id/resync — fuerza a UNA tablet a re-descargar su
// playlist ya (ignora el check de versión). Para cuando una tablet quedó
// mostrando el video de respaldo porque no bajó su playlist.
router.post('/tablet/:id/resync', apiKeyOrAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const tablet = await prisma.tablet.findUnique({ where: { id }, select: { id: true, name: true, playlistId: true, fcmToken: true } });
    if (!tablet) return res.status(404).json({ error: 'No existe' });
    forceSyncFlags.add(id);
    let pushed = 0;
    if (tablet.fcmToken) {
      try { const r = await firebaseAdmin.sendSyncPush([tablet.fcmToken]); pushed = r?.successCount || 0; } catch { /* best-effort */ }
    }
    await audit(req, 'TABLET_RESYNC', 'tablet', id, `${tablet.name} — resync forzado`);
    res.json({
      ok: true,
      hasPlaylist: !!tablet.playlistId,
      message: tablet.playlistId
        ? `"${tablet.name}" va a re-descargar su playlist en el próximo sync${pushed ? ' (empujada por FCM)' : ''}.`
        : `"${tablet.name}" NO tiene playlist asignada — asignale una primero.`,
    });
  } catch (err) { next(err); }
});

// GET /api/admin/tablet/:id/screenshot — última captura + cuándo se tomó.
router.get('/tablet/:id/screenshot', apiKeyOrAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const t = await prisma.tablet.findUnique({
      where: { id }, select: { lastScreenshot: true, lastScreenshotAt: true },
    });
    if (!t) return res.status(404).json({ error: 'No existe' });
    res.json({ image: t.lastScreenshot || null, at: t.lastScreenshotAt || null });
  } catch (err) { next(err); }
});

// GET /api/admin/fleet-health — diagnóstico por tablet (apiKeyOrAuth).
router.get('/fleet-health', apiKeyOrAuth, async (req, res, next) => {
  try {
    const [tablets, playlists] = await Promise.all([
      prisma.tablet.findMany({
        select: { id: true, name: true, playlistId: true, lastSync: true, appVersion: true, fcmToken: true, serial: true, manualStatus: true },
        orderBy: { id: 'asc' },
      }),
      prisma.playlist.findMany({
        select: {
          id: true, name: true, version: true,
          playlistAds: { select: { ad: { select: { id: true, active: true, approvalStatus: true, deletedAt: true, startsAt: true, endsAt: true } } } },
        },
      }),
    ]);
    const now = Date.now();
    const plById = Object.fromEntries(playlists.map((p) => [p.id, p]));
    const rows = tablets.map((t) => {
      const pl = t.playlistId ? plById[t.playlistId] : null;
      const ads = pl?.playlistAds?.map((pa) => pa.ad) ?? [];
      const playable = ads.filter((a) =>
        a.active && !a.deletedAt && a.approvalStatus === 'approved'
        && (!a.startsAt || new Date(a.startsAt) <= now) && (!a.endsAt || new Date(a.endsAt) >= now));
      return {
        id: t.id, name: t.name,
        manualStatus: t.manualStatus,
        playlist: pl ? `${pl.name} (v${pl.version})` : null,
        adsEnPlaylist: ads.length,
        adsReproducibles: playable.length,
        fcmToken: !!t.fcmToken,
        appVersion: t.appVersion,
        serial: t.serial,
        lastSyncHace: t.lastSync ? Math.round((now - new Date(t.lastSync).getTime()) / 1000) + 's' : 'nunca',
      };
    });
    res.json({
      resumen: {
        total: rows.length,
        sinPlaylist: rows.filter((r) => !r.playlist).length,
        playlistVacia: rows.filter((r) => r.playlist && r.adsEnPlaylist === 0).length,
        sinAdsReproducibles: rows.filter((r) => r.playlist && r.adsReproducibles === 0).length,
      },
      tablets: rows,
    });
  } catch (err) { next(err); }
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

// POST /api/admin/apk — upload a new Android release APK for the fleet to
// auto-download (#apk-autoupdate). versionCode/versionName come from
// app/build.gradle.kts at the time of the build; not parsed from the APK
// itself to avoid pulling in a manifest-binary-XML parser for something the
// person uploading already knows.
router.post('/apk', apiKeyOrAuth, apkUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!/\.apk$/i.test(req.file.originalname)) return res.status(400).json({ error: 'El archivo debe ser un .apk' });

    const { versionCode, versionName } = z.object({
      versionCode: z.coerce.number().int().positive(),
      versionName: z.string().min(1),
    }).parse(req.body);

    if (!supabaseStorage.isConfigured) return res.status(503).json({ error: 'Storage not configured' });

    const filename = `apk/iconads-v${versionCode}.apk`;
    const url = await supabaseStorage.uploadFile(filename, req.file.buffer, 'application/vnd.android.package-archive');

    const uploadedAt = new Date().toISOString();
    await Promise.all([
      prisma.systemConfig.upsert({ where: { key: 'apk_version_code' }, update: { value: String(versionCode) }, create: { key: 'apk_version_code', value: String(versionCode) } }),
      prisma.systemConfig.upsert({ where: { key: 'apk_version_name' }, update: { value: versionName }, create: { key: 'apk_version_name', value: versionName } }),
      prisma.systemConfig.upsert({ where: { key: 'apk_url' }, update: { value: url }, create: { key: 'apk_url', value: url } }),
      prisma.systemConfig.upsert({ where: { key: 'apk_uploaded_at' }, update: { value: uploadedAt }, create: { key: 'apk_uploaded_at', value: uploadedAt } }),
    ]);

    await audit(req, 'UPLOAD_APK', 'system', null, `APK v${versionCode} (${versionName})`);
    res.status(201).json({ versionCode, versionName, url, uploadedAt });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// GET /api/admin/apk — versión publicada + estado de despliegue en la flota.
// El breakdown por appVersion sale de lo que cada tablet reporta en /sync.
router.get('/apk', apiKeyOrAuth, async (req, res, next) => {
  try {
    const [configs, tablets] = await Promise.all([
      prisma.systemConfig.findMany({
        where: { key: { in: ['apk_version_code', 'apk_version_name', 'apk_url', 'apk_uploaded_at'] } },
      }),
      prisma.tablet.findMany({ select: { id: true, name: true, appVersion: true, lastSync: true, brightness: true, brightnessAuto: true, lux: true, lightSensor: true, serial: true, batteryLevel: true } }),
    ]);
    const map = Object.fromEntries(configs.map((c) => [c.key, c.value]));
    const publishedName = map.apk_version_name ?? null;

    const byVersion = {};
    for (const t of tablets) {
      const v = t.appVersion || 'desconocida';
      (byVersion[v] ||= []).push({ id: t.id, name: t.name, lastSync: t.lastSync, brightness: t.brightness, brightnessAuto: t.brightnessAuto, lux: t.lux, lightSensor: t.lightSensor, serial: t.serial, battery: t.batteryLevel });
    }
    const versions = Object.entries(byVersion)
      .map(([version, list]) => ({
        version,
        count: list.length,
        upToDate: publishedName != null && version === publishedName,
        tablets: list.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => b.count - a.count);

    res.json({
      published: {
        versionCode: map.apk_version_code ? Number(map.apk_version_code) : null,
        versionName: publishedName,
        url: map.apk_url ?? null,
        uploadedAt: map.apk_uploaded_at ?? null,
      },
      totalTablets: tablets.length,
      upToDate: versions.filter((v) => v.upToDate).reduce((n, v) => n + v.count, 0),
      versions,
    });
  } catch (err) { next(err); }
});

// POST /api/admin/test-mode  { on: true|false }
// Modo test de kiosco: las tablets ignoran el desenchufe y el cierre por
// inactividad (quedan siempre prendidas, botón de encendido = on/off manual).
// Empuja a la flota para que lo agarren rápido.
router.post('/test-mode', apiKeyOrAuth, async (req, res, next) => {
  try {
    const on = req.body?.on === true || req.body?.on === 'true' || req.body?.on === 1;
    await prisma.systemConfig.upsert({
      where: { key: 'kiosk_test_mode' },
      update: { value: on ? '1' : '0' },
      create: { key: 'kiosk_test_mode', value: on ? '1' : '0' },
    });
    const tablets = await prisma.tablet.findMany({ select: { id: true, fcmToken: true } });
    tablets.forEach((t) => forceSyncFlags.add(t.id));
    const tokens = tablets.map((t) => t.fcmToken).filter(Boolean);
    const pushResult = await firebaseAdmin.sendSyncPush(tokens);
    await audit(req, 'SET_TEST_MODE', 'system', null, `kiosk_test_mode=${on ? 'ON' : 'OFF'}`);
    res.json({
      ok: true,
      testMode: on,
      message: `Modo test ${on ? 'ACTIVADO' : 'DESACTIVADO'} — ${tablets.length} tablets marcadas (${pushResult.successCount} al instante).`,
    });
  } catch (err) { next(err); }
});

// POST /api/admin/brightness  { value: 'auto' | 0..255 }
// Política de brillo de toda la flota. 'auto' = brillo automático del sistema.
// Un número = brillo fijo (255 = máximo). En estas tablets el auto dimma
// demasiado, así que conviene un fijo alto (~220).
router.post('/brightness', apiKeyOrAuth, async (req, res, next) => {
  try {
    const raw = req.body?.value;
    let value;
    if (raw === 'auto' || raw === 'max') {
      value = raw === 'max' ? '255' : 'auto';
    } else {
      const n = Math.round(Number(raw));
      if (!Number.isFinite(n) || n < 0 || n > 255) {
        return res.status(400).json({ error: "value debe ser 'auto', 'max' o un número 0-255" });
      }
      value = String(n);
    }
    await prisma.systemConfig.upsert({
      where: { key: 'screen_brightness' },
      update: { value }, create: { key: 'screen_brightness', value },
    });
    const tablets = await prisma.tablet.findMany({ select: { id: true, fcmToken: true } });
    tablets.forEach((t) => forceSyncFlags.add(t.id));
    const pushResult = await firebaseAdmin.sendSyncPush(tablets.map((t) => t.fcmToken).filter(Boolean));
    await audit(req, 'SET_BRIGHTNESS', 'system', null, `screen_brightness=${value}`);
    res.json({ ok: true, value, message: `Brillo = ${value} — ${tablets.length} tablets marcadas (${pushResult.successCount} al instante).` });
  } catch (err) { next(err); }
});

// POST /api/admin/force-update-apk — como force-sync-all pero para la APK:
// marca toda la flota para re-chequear la versión publicada YA (ignorando el
// guard local promptedApkVersion) y las empuja por FCM. Las que ya están en la
// última no hacen nada (checkApkUpdate corta si versionCode <= el instalado).
router.post('/force-update-apk', apiKeyOrAuth, async (req, res, next) => {
  try {
    const tablets = await prisma.tablet.findMany({ select: { id: true, fcmToken: true } });
    tablets.forEach((t) => forceApkFlags.add(t.id));
    const tokens = tablets.map((t) => t.fcmToken).filter(Boolean);
    const pushResult = await firebaseAdmin.sendSyncPush(tokens);
    await audit(req, 'FORCE_APK_UPDATE', 'tablet', null,
      `APK forzada en ${tablets.length} tablets (${pushResult.successCount} push instantáneo)`);
    res.json({
      ok: true,
      count: tablets.length,
      pushed: pushResult.successCount,
      message: tokens.length > 0
        ? `${tablets.length} tablets marcadas — ${pushResult.successCount} chequeando la APK ahora mismo, el resto en su próxima conexión.`
        : `${tablets.length} tablets van a chequear la APK en su próxima conexión.`,
    });
  } catch (err) { next(err); }
});

module.exports = router;
