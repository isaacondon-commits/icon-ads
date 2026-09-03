// Red de seguridad de ancho de banda para GET /api/device/package (el único
// endpoint pesado: sirve el ZIP de la playlist, 30–120 MB).
//
// 3 mecanismos:
//  1) Presupuesto por tablet (memoria): una tablet sana pide su ZIP ~1 vez/día.
//     - repite un hash que YA recibió hoy  -> 204 (0 bytes), sigue reproduciendo
//     - > 2 pedidos en el día              -> se marca anómala + alerta
//     - >= 4 hashes DISTINTOS en el día    -> 429 (bug de flip-flop de playlist)
//  2) Disyuntor mañana/tarde (memoria): ventanas fijas 00:00–12:00 y 12:00–24:00
//     hora de Montevideo, 1 GB de presupuesto por ventana. Si se supera, corta
//     /package para TODA la flota hasta el cambio de ventana + alerta. Reset
//     automático al mediodía / medianoche. Reset manual desde el panel.
//  3) Odómetro mensual (persistido en systemConfig): bytes servidos en el mes.
//     Alerta al cruzar cada múltiplo de 5 GB (5, 10, 15, 20, 25…). Reset el 1°.
//
// El backend conecta como postgres; nada de esto afecta la reproducción: una
// descarga rechazada deja a la tablet con su playlist actual.

const prisma = require('./prisma');

const MVD_OFFSET_MS = 3 * 60 * 60 * 1000; // Montevideo = UTC-3, sin DST
const GB = 1024 * 1024 * 1024;
const WINDOW_BUDGET_BYTES = 500 * 1024 * 1024;   // 500 MB por ventana mañana/tarde
// AUTO-CONGELAR la producción si el egress del MES cruza esto. Margen enorme
// sobre lo que queda del plan (~1,44 GB). Ajustable por systemConfig
// bw_auto_refreeze_gb. Es el "cortá inmediatamente" automatizado.
const AUTO_REFREEZE_BYTES_DEFAULT = 1.0 * GB;
const ALERT_STEP_BYTES = 5 * GB;      // alerta mensual cada 5 GB
const PER_TABLET_DAILY_SOFT = 2;      // > este nº de pedidos/día = anómala
const PER_TABLET_DISTINCT_HARD = 4;   // >= hashes distintos/día = 429

function mvdNow() {
  return new Date(Date.now() - MVD_OFFSET_MS);
}
function windowKey(d = mvdNow()) {
  return `${d.toISOString().slice(0, 10)}-${d.getUTCHours() < 12 ? 'AM' : 'PM'}`;
}
function dayKey(d = mvdNow()) {
  return d.toISOString().slice(0, 10);
}
function monthKey(d = mvdNow()) {
  return d.toISOString().slice(0, 7);
}

// ── estado en memoria ────────────────────────────────────────────────────────
let circuit = { window: windowKey(), bytes: 0, open: false, offenders: {} };
const perTablet = new Map(); // tabletId -> { day, count, hashes:Set }

function rollWindow() {
  const wk = windowKey();
  if (circuit.window !== wk) circuit = { window: wk, bytes: 0, open: false, offenders: {} };
}
function topOffenders(n = 5) {
  return Object.entries(circuit.offenders)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([tabletId, count]) => ({ tabletId: Number(tabletId), count }));
}

// ── odómetro mensual persistente ─────────────────────────────────────────────
async function loadMonthly() {
  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: ['bw_month', 'bw_bytes', 'bw_alerted_step'] } },
  });
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const o = {
    month: m.bw_month || monthKey(),
    bytes: Number(m.bw_bytes || 0),
    alertedStep: Number(m.bw_alerted_step || 0),
  };
  if (o.month !== monthKey()) { o.month = monthKey(); o.bytes = 0; o.alertedStep = 0; }
  return o;
}
async function saveMonthly(o) {
  const up = (key, value) =>
    prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
  await Promise.all([
    up('bw_month', o.month),
    up('bw_bytes', String(o.bytes)),
    up('bw_alerted_step', String(o.alertedStep)),
  ]);
}

// ── API ─────────────────────────────────────────────────────────────────────

// Se llama ANTES de armar/servir el ZIP. Devuelve qué hacer.
//   { action: 'serve' | 'not-modified' | 'circuit-open' | 'rate-limited', ... }
function checkPackageRequest(tabletId, hash) {
  rollWindow();
  if (circuit.open) return { action: 'circuit-open' };

  const day = dayKey();
  let pt = perTablet.get(tabletId);
  if (!pt || pt.day !== day) { pt = { day, count: 0, hashes: new Set() }; perTablet.set(tabletId, pt); }

  pt.count += 1;
  circuit.offenders[tabletId] = (circuit.offenders[tabletId] || 0) + 1;

  // `anomalous` sólo la 1ª vez que cruza el umbral en el día (para no spamear
  // alertas en cada request del loop).
  const overSoft = pt.count > PER_TABLET_DAILY_SOFT;
  const anomalous = overSoft && !pt.alerted;
  if (anomalous) pt.alerted = true;

  // Repite un hash que ya recibió hoy: no se gasta nada, 204.
  if (pt.hashes.has(hash)) {
    return { action: 'not-modified', anomalous, count: pt.count };
  }
  // Hash nuevo = update real. Se permite salvo flip-flop patológico.
  if (pt.hashes.size >= PER_TABLET_DISTINCT_HARD) {
    const first = !pt.hardAlerted;
    pt.hardAlerted = true;
    return { action: 'rate-limited', anomalous: first, count: pt.count, distinct: pt.hashes.size };
  }
  return { action: 'serve', anomalous, count: pt.count };
}

// Se llama DESPUÉS de servir bytes (cache-hit o build nuevo). Devuelve las
// alertas a disparar (para que el caller las mande sin acoplar este módulo a
// alerts.js).
async function recordServed(tabletId, hash, bytes) {
  rollWindow();
  const pt = perTablet.get(tabletId);
  if (pt) pt.hashes.add(hash);
  circuit.bytes += bytes;

  const out = { stepAlertGb: null, circuitAlert: null };

  // odómetro mensual + alerta escalonada + AUTO-CONGELADO
  try {
    const o = await loadMonthly();
    o.bytes += bytes;
    const step = Math.floor(o.bytes / ALERT_STEP_BYTES);
    if (step > o.alertedStep) { out.stepAlertGb = step * 5; o.alertedStep = step; }
    await saveMonthly(o);
    out.monthGb = +(o.bytes / GB).toFixed(2);

    // Techo duro: si el mes cruza el límite, congelar la producción YA.
    let ceiling = AUTO_REFREEZE_BYTES_DEFAULT;
    try {
      const cfg = await prisma.systemConfig.findUnique({ where: { key: 'bw_auto_refreeze_gb' } });
      const g = parseFloat(cfg?.value);
      if (Number.isFinite(g) && g > 0) ceiling = g * GB;
    } catch { /* ignore */ }
    if (o.bytes > ceiling) {
      try {
        const fz = require('./freezeState');
        if (!fz.isFrozen()) { await fz.set(true); out.autoRefrozeGb = +(ceiling / GB).toFixed(2); }
      } catch (e) { console.error('[bwGuard] auto-congelado falló:', e.message); }
    }
  } catch (e) {
    console.warn('[bwGuard] odómetro:', e.message);
  }

  // disyuntor de ventana
  if (!circuit.open && circuit.bytes > WINDOW_BUDGET_BYTES) {
    circuit.open = true;
    out.circuitAlert = {
      window: circuit.window,
      gb: +(circuit.bytes / GB).toFixed(2),
      offenders: topOffenders(),
    };
  }
  return out;
}

async function getStatus() {
  rollWindow();
  let month = { bytes: 0, alertedStep: 0, month: monthKey() };
  try { month = await loadMonthly(); } catch { /* ignore */ }
  let frozen = true;
  try { frozen = require('./freezeState').isFrozen(); } catch { /* ignore */ }
  return {
    frozen,
    monthKey: month.month,
    monthGb: +(month.bytes / GB).toFixed(3),
    nextAlertGb: (month.alertedStep + 1) * 5,
    window: circuit.window,
    windowGb: +(circuit.bytes / GB).toFixed(3),
    windowBudgetGb: WINDOW_BUDGET_BYTES / GB,
    circuitOpen: circuit.open,
    offenders: topOffenders(),
  };
}

function resetCircuit() {
  circuit = { window: windowKey(), bytes: 0, open: false, offenders: {} };
  return { ok: true, window: circuit.window };
}

async function resetOdometer() {
  await saveMonthly({ month: monthKey(), bytes: 0, alertedStep: 0 });
  return { ok: true, month: monthKey() };
}

module.exports = {
  checkPackageRequest,
  recordServed,
  getStatus,
  resetCircuit,
  resetOdometer,
  WINDOW_BUDGET_BYTES,
};
