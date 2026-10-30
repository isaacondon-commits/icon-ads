// Portal de empresas: estadísticas de SOLO LECTURA de las campañas que la
// empresa paga. Todo lo que se devuelve sale filtrado por req.portal.clientId,
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
const { campaignEndsAt } = require('../lib/campaignSchedule');
const {
  signSession, setSessionCookie, clearSessionCookie, newOneTimeToken, hashToken,
  passwordProblem, hashPassword, checkPassword, lockoutFor, RESET_TTL_MS,
  requirePortalProxy, requirePortalSession, logPortalEvent,
} = require('../lib/portalAuth');

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
    const usable = cu && cu.active && cu.passwordHash && cu.client?.active && !cu.client?.deletedAt;
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
    if (!cu || !cu.active || !cu.client?.active || cu.client?.deletedAt || !expiresAt || expiresAt < new Date()) {
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
    if (!cu || !cu.active || !cu.passwordHash || !cu.client?.active || cu.client?.deletedAt) return reply();
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

router.get('/me', (req, res) => {
  res.json({ clientName: req.portal.clientName, email: req.portal.email });
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

function campaignStatus(c, now = new Date()) {
  if (campaignEndsAt(c) <= now) return 'finalizada';
  if (new Date(c.startDate) > now) return 'programada';
  if (!c.active) return 'pausada';
  return 'activa';
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

// Campañas de ESTA empresa (sólo las que paga). Si viene campaignId, tiene que
// ser una de ellas — si no, 404 (no se distingue "no existe" de "es de otro").
async function scope(req) {
  const campaigns = await prisma.campaign.findMany({
    where: { clientId: req.portal.clientId, deletedAt: null },
    select: { id: true, name: true, startDate: true, endDate: true, active: true },
    orderBy: { startDate: 'desc' },
  });
  let ids = campaigns.map((c) => c.id);
  if (req.query.campaignId !== undefined && req.query.campaignId !== '') {
    const id = Number(req.query.campaignId);
    if (!Number.isInteger(id) || !ids.includes(id)) return { notFound: true };
    ids = [id];
  }
  return { campaigns, ids };
}

async function buildStats(ids, from, to) {
  const empty = {
    totals: { plays: 0, completedPlays: 0, completionRate: 0, tablets: 0, ads: 0, secondsOnScreen: 0 },
    daily: [], hourly: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 })), byCampaign: [], byAd: [], byZone: [],
  };
  const fill = (rows) => {
    const map = new Map(rows.map((r) => [r.date, Number(r.count)]));
    const out = [];
    for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
      const key = localDay(t);
      out.push({ date: key, count: map.get(key) ?? 0 });
    }
    return out;
  };
  if (!ids.length) return { ...empty, daily: fill([]) };

  const inIds = Prisma.join(ids);
  const where = Prisma.sql`m.campaign_id IN (${inIds}) AND m.played_at BETWEEN ${from} AND ${to}`;
  const [totals, daily, hourly, byCampaign, byAd, byZone] = await Promise.all([
    prisma.$queryRaw(Prisma.sql`
      SELECT COUNT(*)::int AS plays, COALESCE(SUM(CASE WHEN m.completed THEN 1 ELSE 0 END), 0)::int AS completed,
             COUNT(DISTINCT m.tablet_id)::int AS tablets, COUNT(DISTINCT m.ad_id)::int AS ads,
             COALESCE(SUM(m.duration_played_s), 0)::bigint AS seconds
      FROM metrics m WHERE ${where}`),
    prisma.$queryRaw(Prisma.sql`
      SELECT TO_CHAR(DATE(m.played_at AT TIME ZONE 'America/Montevideo'), 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
      FROM metrics m WHERE ${where} GROUP BY 1 ORDER BY 1`),
    prisma.$queryRaw(Prisma.sql`
      SELECT EXTRACT(HOUR FROM m.played_at AT TIME ZONE 'America/Montevideo')::int AS hour, COUNT(*)::int AS count
      FROM metrics m WHERE ${where} GROUP BY 1`),
    prisma.$queryRaw(Prisma.sql`
      SELECT m.campaign_id AS id, COUNT(*)::int AS plays, COUNT(DISTINCT m.tablet_id)::int AS tablets
      FROM metrics m WHERE ${where} GROUP BY 1`),
    prisma.$queryRaw(Prisma.sql`
      SELECT a.name AS name, a.type::text AS type, c.name AS campaign, COUNT(*)::int AS plays,
             COALESCE(SUM(CASE WHEN m.completed THEN 1 ELSE 0 END), 0)::int AS completed
      FROM metrics m JOIN ads a ON a.id = m.ad_id JOIN campaigns c ON c.id = m.campaign_id
      WHERE ${where} GROUP BY a.id, a.name, a.type, c.name ORDER BY plays DESC LIMIT 100`),
    // Zona = la etiqueta de zona cargada a mano en la tablet. Nunca GPS.
    prisma.$queryRaw(Prisma.sql`
      SELECT t.zone AS zone, COUNT(*)::int AS plays
      FROM metrics m JOIN tablets t ON t.id = m.tablet_id
      WHERE ${where} AND t.zone IS NOT NULL AND t.zone <> '' GROUP BY 1 ORDER BY plays DESC LIMIT 20`),
  ]);

  const t = totals[0] || {};
  const plays = Number(t.plays || 0);
  const completed = Number(t.completed || 0);
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
  for (const r of hourly) hours[Number(r.hour)].count = Number(r.count);
  return {
    totals: {
      plays, completedPlays: completed,
      completionRate: plays ? Math.round((completed / plays) * 1000) / 10 : 0,
      tablets: Number(t.tablets || 0), ads: Number(t.ads || 0), secondsOnScreen: Number(t.seconds || 0),
    },
    daily: fill(daily),
    hourly: hours,
    byCampaign: byCampaign.map((r) => ({ id: Number(r.id), plays: Number(r.plays), tablets: Number(r.tablets) })),
    byAd: byAd.map((r) => ({
      name: r.name, type: r.type, campaign: r.campaign, plays: Number(r.plays),
      completionRate: Number(r.plays) ? Math.round((Number(r.completed) / Number(r.plays)) * 1000) / 10 : 0,
    })),
    byZone: byZone.map((r) => ({ zone: r.zone, plays: Number(r.plays) })),
  };
}

router.get('/campaigns', async (req, res, next) => {
  try {
    const { campaigns } = await scope({ ...req, query: {} });
    const ids = campaigns.map((c) => c.id);
    const totals = ids.length
      ? await prisma.metric.groupBy({ by: ['campaignId'], where: { campaignId: { in: ids } }, _count: { _all: true }, _max: { playedAt: true } })
      : [];
    const byId = new Map(totals.map((t) => [t.campaignId, t]));
    res.json(campaigns.map((c) => ({
      id: c.id, name: c.name, startDate: c.startDate, endDate: c.endDate, status: campaignStatus(c),
      totalPlays: byId.get(c.id)?._count._all ?? 0,
      lastPlayAt: byId.get(c.id)?._max.playedAt ?? null,
    })));
  } catch (err) { next(err); }
});

router.get('/stats', async (req, res, next) => {
  try {
    const range = parseRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });
    const s = await scope(req);
    if (s.notFound) return res.status(404).json({ error: 'Campaña no encontrada.' });
    const stats = await buildStats(s.ids, range.from, range.to);
    const names = new Map(s.campaigns.map((c) => [c.id, c]));
    stats.byCampaign = stats.byCampaign.map((r) => ({ ...r, name: names.get(r.id)?.name, status: campaignStatus(names.get(r.id)) }));
    res.json({ from: range.fromStr, to: range.toStr, ...stats });
  } catch (err) { next(err); }
});

// ── PDF ─────────────────────────────────────────────────────────────────────

const LOGO = path.join(__dirname, '../../assets/iconads-logo.png');
const fmtInt = (n) => Number(n).toLocaleString('es-AR');
const fmtDay = (s) => s.split('-').reverse().join('/');
const STATUS_LABEL = { activa: 'Activa', programada: 'Programada', pausada: 'Pausada', finalizada: 'Finalizada' };

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
    const s = await scope(req);
    if (s.notFound) return res.status(404).json({ error: 'Campaña no encontrada.' });
    const st = await buildStats(s.ids, range.from, range.to);
    const camp = new Map(s.campaigns.map((c) => [c.id, c]));
    const single = s.ids.length === 1 && req.query.campaignId ? camp.get(s.ids[0]) : null;

    const doc = pdf.createDoc();
    doc.image(LOGO, 50, 36, { fit: [86, 86] });
    doc.fillColor(pdf.BLACK).fontSize(18).font('Helvetica-Bold').text('Reporte de reproducciones', 150, 50);
    doc.fontSize(11).font('Helvetica').fillColor(pdf.GRAY)
      .text(req.portal.clientName, 150, 74)
      .text(`${single ? `Campaña: ${single.name} — ` : ''}Del ${fmtDay(range.fromStr)} al ${fmtDay(range.toStr)}`, 150, 90);
    doc.y = 135;

    pdf.sectionTitle(doc, 'Resumen');
    pdf.row(doc, 'Reproducciones', fmtInt(st.totals.plays), true);
    pdf.row(doc, 'Reproducciones completas', `${fmtInt(st.totals.completedPlays)} (${st.totals.completionRate}%)`);
    pdf.row(doc, 'Tiempo en pantalla', `${fmtInt(Math.round(st.totals.secondsOnScreen / 60))} minutos`);
    pdf.row(doc, 'Taxis que la mostraron', fmtInt(st.totals.tablets));
    pdf.row(doc, 'Anuncios reproducidos', fmtInt(st.totals.ads));

    if (!single && st.byCampaign.length) {
      pdf.sectionTitle(doc, 'Por campaña');
      pdfTable(doc,
        [{ label: 'Campaña', w: 0.46 }, { label: 'Estado', w: 0.16 }, { label: 'Taxis', w: 0.14, align: 'right' }, { label: 'Reproducciones', w: 0.24, align: 'right' }],
        st.byCampaign.sort((a, b) => b.plays - a.plays).map((r) => {
          const c = camp.get(r.id);
          return [c?.name, STATUS_LABEL[campaignStatus(c)], fmtInt(r.tablets), fmtInt(r.plays)];
        }));
    }

    if (st.byAd.length) {
      pdf.sectionTitle(doc, 'Por anuncio');
      pdfTable(doc,
        [{ label: 'Anuncio', w: 0.42 }, { label: 'Tipo', w: 0.12 }, { label: 'Completas', w: 0.18, align: 'right' }, { label: 'Reproducciones', w: 0.28, align: 'right' }],
        st.byAd.map((a) => [a.name, a.type === 'video' ? 'Video' : 'Imagen', `${a.completionRate}%`, fmtInt(a.plays)]));
    }

    // Distribución por hora: barras.
    if (st.totals.plays) {
      if (doc.y > doc.page.height - 200) { doc.addPage(); doc.y = 50; }
      pdf.sectionTitle(doc, 'Reproducciones por hora del día');
      const max = Math.max(...st.hourly.map((h) => h.count), 1);
      const chartW = doc.page.width - 100;
      const barW = chartW / 24;
      const baseY = doc.y + 90;
      st.hourly.forEach((h, i) => {
        const bh = (h.count / max) * 80;
        doc.rect(50 + i * barW + 2, baseY - bh, barW - 4, bh).fill(pdf.BLUE);
        doc.fontSize(6.5).fillColor(pdf.GRAY).text(String(h.hour).padStart(2, '0'), 50 + i * barW, baseY + 3, { width: barW, align: 'center' });
      });
      doc.y = baseY + 20;
    }

    if (st.byZone.length) {
      pdf.sectionTitle(doc, 'Por zona');
      pdfTable(doc, [{ label: 'Zona', w: 0.7 }, { label: 'Reproducciones', w: 0.3, align: 'right' }],
        st.byZone.map((z) => [z.zone, fmtInt(z.plays)]));
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
