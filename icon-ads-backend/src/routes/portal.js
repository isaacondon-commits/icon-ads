// Portal de empresas: estadísticas de los anuncios de la empresa y envío de
// anuncios nuevos (quedan pendientes de aprobación; ver routes/portalUpload.js). Todo lo que se devuelve sale filtrado por req.portal.clientId,
// que viene de la sesión y nunca de la URL. Sin datos de GPS, tablets
// individuales, choferes, precios ni de otras empresas.
//
// Se monta en /api/portal y sólo atiende pedidos del proxy del panel
// (requirePortalProxy). Ver lib/portalAuth.js.

const router = require('express').Router();
const path = require('path');
const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const prisma = require('../lib/prisma');
const pdf = require('../lib/pdfHelper');
const { sendAlert } = require('../lib/alerts');
const { sendReset } = require('../lib/portalMailer');
const {
  signSession, setSessionCookie, clearSessionCookie, newOneTimeToken, hashToken,
  passwordProblem, hashPassword, checkPassword, lockoutFor, RESET_TTL_MS,
  requirePortalProxy, requirePortalSession, logPortalEvent, signUploadTicket,
} = require('../lib/portalAuth');
const { MAX_PENDING_UPLOADS } = require('./portalUpload');
const { maxSecondsForClient } = require('../lib/portalLimits');

router.use(requirePortalProxy);

// Nada del portal se cachea en el navegador ni en proxies intermedios.
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// ── Límites por IP (la IP real la manda el proxy) ───────────────────────────
let lastLimitAlert = 0;
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.portalIp),
  handler: (req, res) => {
    if (Date.now() - lastLimitAlert > 15 * 60 * 1000) {
      lastLimitAlert = Date.now();
      sendAlert('portal_login_flood', 'Portal: muchos intentos desde una IP',
        `La IP ${req.portalIp} superó el límite de intentos de acceso al portal de empresas. Se la frena 15 minutos.`, 'warning').catch(() => {});
    }
    res.status(429).json({ error: 'Demasiados intentos. Probá de nuevo en 15 minutos.' });
  },
});
const dataLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.portalIp),
  message: { error: 'Demasiadas consultas. Esperá un minuto.' },
});

const GENERIC_LOGIN_ERROR = 'Email o contraseña incorrectos.';
const emailSchema = z.string().trim().toLowerCase().email().max(254);

// ── Sesión ──────────────────────────────────────────────────────────────────

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const parsed = z.object({ email: emailSchema, password: z.string().min(1).max(200) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: GENERIC_LOGIN_ERROR });
    const { email, password } = parsed.data;

    const cu = await prisma.clientUser.findUnique({
      where: { email },
      include: { client: { select: { active: true, deletedAt: true } } },
    });
    // Empresa pausada: entra igual (sus anuncios no salen, pero ve sus datos).
    const usable = cu && cu.active && cu.passwordHash && cu.client && !cu.client.deletedAt;
    const locked = usable && cu.lockedUntil && cu.lockedUntil > new Date();
    // Siempre se compara un hash (aunque la cuenta no exista o esté frenada),
    // así todas las respuestas tardan lo mismo y dicen lo mismo.
    const ok = await checkPassword(password, usable && !locked ? cu.passwordHash : null);

    if (!ok) {
      if (usable && !locked) {
        const failed = cu.failedLogins + 1;
        await prisma.clientUser.update({ where: { id: cu.id }, data: { failedLogins: failed, lockedUntil: lockoutFor(failed) } });
        if (failed === 5) {
          sendAlert('portal_account_attack', 'Portal: intentos fallidos sobre una cuenta',
            `La cuenta del portal ${cu.email} tuvo 5 contraseñas incorrectas seguidas (última IP ${req.portalIp}). Se frena con demoras crecientes.`, 'warning').catch(() => {});
        }
      }
      await logPortalEvent('PORTAL_LOGIN_FAILED', cu?.id, `email=${email}${locked ? ' (frenada)' : ''}`, req.portalIp);
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    const updated = await prisma.clientUser.update({
      where: { id: cu.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: req.portalIp },
    });
    setSessionCookie(res, signSession(updated));
    await logPortalEvent('PORTAL_LOGIN', cu.id, null, req.portalIp);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/logout', async (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Activar la cuenta (enlace de invitación) o restablecer la contraseña.
// Ambos: token de un solo uso + contraseña nueva -> cierra las demás sesiones
// y deja la sesión iniciada.
async function setPasswordWithToken(req, res, next, kind) {
  try {
    const parsed = z.object({ token: z.string().min(20).max(200), password: z.string().max(200) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'El enlace no es válido.' });
    const hash = hashToken(parsed.data.token);
    const where = kind === 'invite' ? { inviteTokenHash: hash } : { resetTokenHash: hash };
    const cu = await prisma.clientUser.findUnique({
      where, include: { client: { select: { active: true, deletedAt: true } } },
    });
    const expiresAt = kind === 'invite' ? cu?.inviteExpiresAt : cu?.resetExpiresAt;
    if (!cu || !cu.active || !cu.client || cu.client.deletedAt || !expiresAt || expiresAt < new Date()) {
      return res.status(400).json({ error: 'El enlace venció o ya se usó. Pedí uno nuevo.' });
    }
    const problem = passwordProblem(parsed.data.password, cu.email);
    if (problem) return res.status(400).json({ error: problem });

    const updated = await prisma.clientUser.update({
      where: { id: cu.id },
      data: {
        passwordHash: await hashPassword(parsed.data.password),
        sessionVersion: { increment: 1 },
        failedLogins: 0, lockedUntil: null,
        inviteTokenHash: null, inviteExpiresAt: null,
        resetTokenHash: null, resetExpiresAt: null,
        lastLoginAt: new Date(), lastLoginIp: req.portalIp,
      },
    });
    setSessionCookie(res, signSession(updated));
    await logPortalEvent(kind === 'invite' ? 'PORTAL_ACTIVATED' : 'PORTAL_PASSWORD_RESET', cu.id, null, req.portalIp);
    res.json({ ok: true });
  } catch (err) { next(err); }
}
router.post('/activate', authLimiter, (req, res, next) => setPasswordWithToken(req, res, next, 'invite'));
router.post('/password/reset', authLimiter, (req, res, next) => setPasswordWithToken(req, res, next, 'reset'));

// "Olvidé mi contraseña": la respuesta es siempre la misma, exista o no la
// cuenta. Como mucho un mail cada 5 minutos por cuenta.
router.post('/password/forgot', authLimiter, async (req, res, next) => {
  const reply = () => res.json({ ok: true, message: 'Si el email tiene acceso al portal, te llega un enlace para cambiar la contraseña.' });
  try {
    const parsed = emailSchema.safeParse(req.body?.email);
    if (!parsed.success) return reply();
    const cu = await prisma.clientUser.findUnique({
      where: { email: parsed.data }, include: { client: { select: { active: true, deletedAt: true } } },
    });
    if (!cu || !cu.active || !cu.passwordHash || !cu.client || cu.client.deletedAt) return reply();
    const recentlySent = cu.resetExpiresAt && cu.resetExpiresAt.getTime() - RESET_TTL_MS > Date.now() - 5 * 60 * 1000;
    if (recentlySent) return reply();
    const { token, hash } = newOneTimeToken();
    await prisma.clientUser.update({
      where: { id: cu.id },
      data: { resetTokenHash: hash, resetExpiresAt: new Date(Date.now() + RESET_TTL_MS) },
    });
    const r = await sendReset({ to: cu.email, token });
    await logPortalEvent('PORTAL_RESET_REQUESTED', cu.id, r.sent ? null : r.error, req.portalIp);
    reply();
  } catch (err) { next(err); }
});

// ── Todo lo de abajo exige sesión ───────────────────────────────────────────
router.use(requirePortalSession, dataLimiter);

router.get('/me', async (req, res, next) => {
  try {
    res.json({ clientName: req.portal.clientName, email: req.portal.email, maxAdSeconds: await maxSecondsForClient(req.portal.clientId) });
  } catch (err) { next(err); }
});

router.post('/password/change', async (req, res, next) => {
  try {
    const parsed = z.object({ currentPassword: z.string().max(200), newPassword: z.string().max(200) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Datos inválidos.' });
    const cu = await prisma.clientUser.findUnique({ where: { id: req.portal.clientUserId } });
    if (!(await checkPassword(parsed.data.currentPassword, cu.passwordHash))) {
      return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
    }
    const problem = passwordProblem(parsed.data.newPassword, cu.email);
    if (problem) return res.status(400).json({ error: problem });
    const updated = await prisma.clientUser.update({
      where: { id: cu.id },
      data: { passwordHash: await hashPassword(parsed.data.newPassword), sessionVersion: { increment: 1 } },
    });
    setSessionCookie(res, signSession(updated));
    await logPortalEvent('PORTAL_PASSWORD_CHANGED', cu.id, null, req.portalIp);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Datos ───────────────────────────────────────────────────────────────────

const MVD_OFFSET_MS = 3 * 60 * 60 * 1000; // Montevideo = UTC-3, sin horario de verano
const DAY_MS = 86400000;
const MAX_RANGE_DAYS = 366;

// Anuncios de la empresa. Un anuncio es de UNA empresa (ads.client_id), así
// que todo sale de acá — las playlists mezclan empresas y nunca se exponen.

// El portal muestra el "nombre público" del anuncio; si no tiene, "Anuncio N"
// (numerado por fecha de alta, estable). Nunca el nombre interno / de archivo.
function labelAds(ads) {
  const sorted = [...ads].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || a.id - b.id);
  return new Map(sorted.map((a, i) => [a.id, a.publicName || `Anuncio ${i + 1}`]));
}

function adStatus(ad, now = new Date()) {
  if (ad.endsAt && new Date(ad.endsAt) < now) return 'finalizado';
  if (ad.startsAt && new Date(ad.startsAt) > now) return 'programado';
  if (!ad.active || ad.approvalStatus !== 'approved') return 'pausado';
  return 'activo';
}

function localDay(d) {
  return new Date(new Date(d).getTime() - MVD_OFFSET_MS).toISOString().slice(0, 10);
}

// from/to = días locales 'YYYY-MM-DD' (inclusive). Por defecto, últimos 30 días.
function parseRange(q) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const today = localDay(new Date());
  const toStr = re.test(q.to || '') ? q.to : today;
  const fromStr = re.test(q.from || '') ? q.from : localDay(Date.now() - 29 * DAY_MS);
  const from = new Date(Date.parse(`${fromStr}T00:00:00Z`) + MVD_OFFSET_MS);
  const to = new Date(Date.parse(`${toStr}T00:00:00Z`) + MVD_OFFSET_MS + DAY_MS - 1);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return { error: 'Rango de fechas inválido.' };
  if ((to - from) / DAY_MS > MAX_RANGE_DAYS) return { error: 'El rango máximo es de un año.' };
  return { from, to, fromStr, toStr };
}

// Anuncios de ESTA empresa (incluye archivados: sus reproducciones pasadas
// siguen contando). Si viene adId, tiene que ser uno de ellos — si no, 404 (no
// se distingue "no existe" de "es de otra empresa").
async function scope(req) {
  const ads = await prisma.ad.findMany({
    where: { clientId: req.portal.clientId },
    select: { id: true, publicName: true, type: true, active: true, approvalStatus: true, startsAt: true, endsAt: true, deletedAt: true, createdAt: true },
  });
  const labels = labelAds(ads);
  let ids = ads.map((a) => a.id);
  if (req.query.adId !== undefined && req.query.adId !== '') {
    const id = Number(req.query.adId);
    if (!Number.isInteger(id) || !ids.includes(id)) return { notFound: true };
    ids = [id];
  }
  return { ads, labels, ids };
}

// Taxis asignados: tablets (no bloqueadas) cuya playlist tiene el anuncio.
// Cuenta los anuncios aprobados que no terminaron; no mira si la playlist está
// pausada ni el horario del día. Devuelve { perAd: Map(adId -> cantidad),
// total: tablets distintas }.
async function tabletsAssigned(ads, now = new Date()) {
  const ids = ads.filter((a) => !a.deletedAt && a.approvalStatus === 'approved' && !(a.endsAt && new Date(a.endsAt) < now)).map((a) => a.id);
  if (!ids.length) return { perAd: new Map(), total: 0 };
  const links = await prisma.playlistAd.findMany({
    where: { adId: { in: ids } },
    select: { adId: true, playlistId: true },
  });
  const playlistIds = [...new Set(links.map((l) => l.playlistId))];
  const tablets = playlistIds.length
    ? await prisma.tablet.findMany({ where: { playlistId: { in: playlistIds }, manualStatus: { not: 'bloqueada' } }, select: { id: true, playlistId: true } })
    : [];
  const byPlaylist = new Map();
  for (const t of tablets) (byPlaylist.get(t.playlistId) || byPlaylist.set(t.playlistId, []).get(t.playlistId)).push(t.id);
  const perAdSets = new Map();
  for (const l of links) {
    const set = perAdSets.get(l.adId) || perAdSets.set(l.adId, new Set()).get(l.adId);
    for (const id of byPlaylist.get(l.playlistId) || []) set.add(id);
  }
  const all = new Set();
  const perAd = new Map();
  for (const [adId, set] of perAdSets) { perAd.set(adId, set.size); for (const id of set) all.add(id); }
  return { perAd, total: all.size };
}

// Lo que ve la empresa: reproducciones (con comparación), por día, por
// anuncio y taxis asignados. Nada más.
async function buildStats(sc, from, to) {
  const { ids, labels, ads } = sc;
  const assigned = await tabletsAssigned(ads.filter((a) => ids.includes(a.id)));
  const fill = (rows) => {
    const map = new Map(rows.map((r) => [r.date, Number(r.count)]));
    const out = [];
    for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
      const key = localDay(t);
      out.push({ date: key, count: map.get(key) ?? 0 });
    }
    return out;
  };
  // Período anterior de la misma duración, para la comparación.
  const span = to.getTime() - from.getTime() + 1;
  const prevFrom = new Date(from.getTime() - span);
  const prevTo = new Date(from.getTime() - 1);

  if (!ids.length) {
    return { totals: { plays: 0, tabletsAssigned: 0, previousPlays: 0, changePct: null }, daily: fill([]), byAd: [] };
  }

  const inIds = Prisma.join(ids);
  const where = Prisma.sql`m.ad_id IN (${inIds}) AND m.played_at BETWEEN ${from} AND ${to}`;
  const [totals, prev, daily, byAd] = await Promise.all([
    prisma.$queryRaw(Prisma.sql`SELECT COUNT(*)::int AS plays FROM metrics m WHERE ${where}`),
    prisma.$queryRaw(Prisma.sql`
      SELECT COUNT(*)::int AS plays FROM metrics m
      WHERE m.ad_id IN (${inIds}) AND m.played_at BETWEEN ${prevFrom} AND ${prevTo}`),
    prisma.$queryRaw(Prisma.sql`
      SELECT TO_CHAR(DATE(m.played_at AT TIME ZONE 'America/Montevideo'), 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
      FROM metrics m WHERE ${where} GROUP BY 1 ORDER BY 1`),
    prisma.$queryRaw(Prisma.sql`SELECT m.ad_id AS id, COUNT(*)::int AS plays FROM metrics m WHERE ${where} GROUP BY 1`),
  ]);

  const plays = Number(totals[0]?.plays || 0);
  const previousPlays = Number(prev[0]?.plays || 0);
  const adById = new Map(ads.map((a) => [a.id, a]));
  const playedIds = new Set(byAd.map((r) => Number(r.id)));
  // Por anuncio: los que se reprodujeron en el rango + los que tienen taxis
  // asignados aunque todavía no sumen reproducciones.
  const rows = [
    ...byAd.map((r) => ({ id: Number(r.id), plays: Number(r.plays) })),
    ...[...assigned.perAd.keys()].filter((id) => !playedIds.has(id)).map((id) => ({ id, plays: 0 })),
  ];
  return {
    totals: {
      plays, tabletsAssigned: assigned.total, previousPlays,
      changePct: previousPlays ? Math.round(((plays - previousPlays) / previousPlays) * 1000) / 10 : null,
    },
    daily: fill(daily),
    byAd: rows
      .map((r) => {
        const ad = adById.get(r.id);
        return {
          id: r.id, name: labels.get(r.id), type: ad?.type, status: ad ? (ad.deletedAt ? 'finalizado' : adStatus(ad)) : 'finalizado',
          plays: r.plays, tabletsAssigned: assigned.perAd.get(r.id) ?? 0,
        };
      })
      .sort((x, y) => y.plays - x.plays || y.tabletsAssigned - x.tabletsAssigned),
  };
}

router.get('/ads', async (req, res, next) => {
  try {
    const sc = await scope({ ...req, query: {} });
    const visible = sc.ads.filter((a) => !a.deletedAt && a.approvalStatus === 'approved');
    const ids = visible.map((a) => a.id);
    const [totals, now] = await Promise.all([
      ids.length ? prisma.metric.groupBy({ by: ['adId'], where: { adId: { in: ids } }, _count: { _all: true }, _max: { playedAt: true } }) : [],
      tabletsAssigned(visible),
    ]);
    const byId = new Map(totals.map((t) => [t.adId, t]));
    res.json(visible
      .map((a) => ({
        id: a.id, name: sc.labels.get(a.id), type: a.type, startsAt: a.startsAt, endsAt: a.endsAt, status: adStatus(a),
        totalPlays: byId.get(a.id)?._count._all ?? 0,
        lastPlayAt: byId.get(a.id)?._max.playedAt ?? null,
        tabletsAssigned: now.perAd.get(a.id) ?? 0,
      }))
      .sort((x, y) => String(x.name).localeCompare(String(y.name), 'es', { numeric: true })));
  } catch (err) { next(err); }
});

// ── Anuncios enviados por la empresa ────────────────────────────────────────

// Permiso para mandar UN archivo directo al backend (ver portalAuth.js).
router.post('/upload-ticket', async (req, res, next) => {
  try {
    const pending = await prisma.ad.count({
      where: { clientId: req.portal.clientId, uploadedByClient: true, approvalStatus: 'pending', deletedAt: null },
    });
    if (pending >= MAX_PENDING_UPLOADS) {
      return res.status(429).json({ error: `Ya tenés ${pending} anuncios esperando revisión. Esperá a que los revisemos para mandar más.` });
    }
    res.json({ ticket: signUploadTicket(req.portal) });
  } catch (err) { next(err); }
});

const UPLOAD_STATUS = { pending: 'revision', approved: 'aprobado', rejected: 'rechazado' };

router.get('/uploads', async (req, res, next) => {
  try {
    const ads = await prisma.ad.findMany({
      where: { clientId: req.portal.clientId, uploadedByClient: true, deletedAt: null },
      select: { id: true, publicName: true, type: true, durationS: true, approvalStatus: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(ads.map((a) => ({
      id: a.id, name: a.publicName || 'Sin nombre', type: a.type, durationS: a.durationS,
      status: UPLOAD_STATUS[a.approvalStatus] ?? 'revision', createdAt: a.createdAt,
    })));
  } catch (err) { next(err); }
});

router.get('/stats', async (req, res, next) => {
  try {
    const range = parseRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });
    const sc = await scope(req);
    if (sc.notFound) return res.status(404).json({ error: 'Anuncio no encontrado.' });
    const stats = await buildStats(sc, range.from, range.to);
    res.json({ from: range.fromStr, to: range.toStr, ...stats });
  } catch (err) { next(err); }
});

// ── PDF ─────────────────────────────────────────────────────────────────────

const LOGO = path.join(__dirname, '../../assets/iconads-logo.png');
const fmtInt = (n) => Number(n).toLocaleString('es-AR');
const fmtDay = (s) => s.split('-').reverse().join('/');
const STATUS_LABEL = { activo: 'Activo', programado: 'Programado', pausado: 'Pausado', finalizado: 'Finalizado' };

function pdfTable(doc, cols, rows) {
  const x0 = 50;
  const width = doc.page.width - 100;
  const drawHeader = () => {
    let x = x0;
    doc.fontSize(8).font('Helvetica-Bold').fillColor(pdf.GRAY);
    const y = doc.y;
    for (const c of cols) { doc.text(c.label, x, y, { width: c.w * width, align: c.align || 'left' }); x += c.w * width; }
    doc.y = y + 14;
  };
  drawHeader();
  rows.forEach((r, i) => {
    if (doc.y > doc.page.height - 80) { doc.addPage(); doc.y = 50; drawHeader(); }
    const y = doc.y;
    if (i % 2 === 0) doc.rect(x0 - 4, y - 3, width + 8, 15).fill(pdf.LIGHT);
    let x = x0;
    doc.fontSize(8.5).font('Helvetica').fillColor(pdf.BLACK);
    cols.forEach((c, j) => {
      doc.text(String(r[j] ?? ''), x, y, { width: c.w * width - 4, align: c.align || 'left', lineBreak: false, ellipsis: true });
      x += c.w * width;
    });
    doc.y = y + 15;
  });
  doc.moveDown(0.5);
}

router.get('/report.pdf', async (req, res, next) => {
  try {
    const range = parseRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });
    const sc = await scope(req);
    if (sc.notFound) return res.status(404).json({ error: 'Anuncio no encontrado.' });
    const st = await buildStats(sc, range.from, range.to);
    const single = req.query.adId ? sc.labels.get(sc.ids[0]) : null;

    const doc = pdf.createDoc();
    doc.image(LOGO, 50, 36, { fit: [86, 86] });
    doc.fillColor(pdf.BLACK).fontSize(18).font('Helvetica-Bold').text('Reporte de reproducciones', 150, 50);
    doc.fontSize(11).font('Helvetica').fillColor(pdf.GRAY)
      .text(req.portal.clientName, 150, 74)
      .text(`${single ? `Anuncio: ${single} — ` : ''}Del ${fmtDay(range.fromStr)} al ${fmtDay(range.toStr)}`, 150, 90);
    doc.y = 135;

    const change = st.totals.changePct === null ? '' : ` (${st.totals.changePct >= 0 ? '+' : ''}${st.totals.changePct}% vs. período anterior)`;
    pdf.sectionTitle(doc, 'Resumen');
    pdf.row(doc, 'Reproducciones', `${fmtInt(st.totals.plays)}${change}`, true);
    pdf.row(doc, 'Taxis asignados', fmtInt(st.totals.tabletsAssigned));

    if (!single && st.byAd.length) {
      pdf.sectionTitle(doc, 'Por anuncio');
      pdfTable(doc,
        [{ label: 'Anuncio', w: 0.46 }, { label: 'Estado', w: 0.16 }, { label: 'Taxis asignados', w: 0.2, align: 'right' }, { label: 'Reprod.', w: 0.18, align: 'right' }],
        st.byAd.map((a) => [a.name, STATUS_LABEL[a.status], fmtInt(a.tabletsAssigned), fmtInt(a.plays)]));
    }

    pdf.sectionTitle(doc, 'Reproducciones por día');
    pdfTable(doc, [{ label: 'Día', w: 0.6 }, { label: 'Reproducciones', w: 0.4, align: 'right' }],
      st.daily.map((d) => [fmtDay(d.date), fmtInt(d.count)]));

    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(pages.start + i);
      // El pie va dentro del margen inferior: sin bajarlo, pdfkit agrega una hoja.
      const margin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fontSize(7.5).font('Helvetica').fillColor(pdf.GRAY)
        .text(`ICON ADS — Datos registrados por las tablets de la flota · Generado el ${new Date().toLocaleString('es-UY', { timeZone: 'America/Montevideo' })} · Página ${i + 1} de ${pages.count}`,
          50, doc.page.height - 40, { align: 'center', width: doc.page.width - 100, lineBreak: false });
      doc.page.margins.bottom = margin;
    }

    const buf = await pdf.bufferize(doc);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="reporte_iconads_${range.fromStr}_${range.toStr}.pdf"`);
    res.send(buf);
  } catch (err) { next(err); }
});

module.exports = router;
