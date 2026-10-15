// Mantenimiento de la flota: órdenes de trabajo, estado "en taller",
// repuestos, alertas calculadas con lo que ya reportan las tablets y reglas
// recurrentes. Las tablas viven sólo en startup-migrate (SQL crudo, como
// surveys/tablet_locations): no están en schema.prisma.
const prisma = require('./prisma');
const notifyChannels = require('./notify');

const TYPES = {
  revision:  'Revisión general',
  cable:     'Cable / cargador',
  pantalla:  'Pantalla',
  soporte:   'Soporte',
  reemplazo: 'Reemplazo de tablet',
  limpieza:  'Limpieza',
  software:  'App / software',
  otro:      'Otro',
};
const STATUSES = ['pendiente', 'en_curso', 'hecha', 'cancelada'];
const OPEN = ['pendiente', 'en_curso'];
const PRIORITIES = ['baja', 'normal', 'alta', 'urgente'];

const DEFAULT_CHECKLISTS = {
  revision: [
    'Pantalla limpia y sin daños',
    'Soporte firme, sin juego',
    'Carga con el auto en marcha',
    'Brillo correcto',
    'Reproduce la playlist asignada',
    'Fecha y hora correctas',
  ],
  cable: [
    'Probar el cargador con el auto en marcha',
    'Revisar el cable (cortes, conector flojo)',
    'Reemplazar cable/cargador si hace falta',
    'Confirmar que la tablet carga',
  ],
  pantalla: [
    'Revisar rayas, golpes o manchas',
    'Limpiar la pantalla',
    'Brillo y colores correctos',
  ],
  soporte: [
    'Ajustar tornillos',
    'Revisar que no vibre',
    'Orientación correcta (no queda al revés)',
  ],
  reemplazo: [
    'Tablet de reserva con la app instalada',
    'Datos pasados a la de reserva desde el panel',
    'Instalada en el taxi y reproduciendo',
    'Tablet vieja llevada al taller',
  ],
  limpieza: [
    'Limpiar pantalla',
    'Limpiar carcasa y rejillas',
    'Revisar soporte y cable',
  ],
  software: [
    'App en la última versión',
    'Reiniciar la app o la tablet',
    'Confirmar que sincroniza y reproduce',
  ],
  otro: [],
};

// Qué tipo de orden sugiere cada alerta.
const ALERT_ORDER_TYPE = {
  sin_sync_nunca: 'revision',
  offline: 'revision',
  offline_largo: 'revision',
  no_reproduce: 'software',
  fallback: 'software',
  bateria: 'cable',
  temperatura: 'revision',
  version: 'software',
  errores: 'software',
  fecha_vencida: 'revision',
};

const iso = (d) => (d ? new Date(d).toISOString() : null);
const num = (v) => (v == null ? v : Number(v));
const json = (v, fallback) => {
  if (v == null) return fallback;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return fallback; } }
  return v;
};

function mapOrder(r) {
  return {
    id: num(r.id),
    tabletId: r.tablet_id == null ? null : num(r.tablet_id),
    tabletName: r.tablet_name,
    type: r.type,
    title: r.title,
    status: r.status,
    priority: r.priority,
    scheduledFor: iso(r.scheduled_for),
    assignee: r.assignee,
    notes: r.notes,
    resolution: r.resolution,
    checklist: json(r.checklist, []),
    photos: json(r.photos, []),
    parts: json(r.parts, []),
    partsApplied: r.parts_applied,
    workshop: r.workshop,
    source: r.source,
    alertCode: r.alert_code,
    ruleId: r.rule_id == null ? null : num(r.rule_id),
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    startedAt: iso(r.started_at),
    completedAt: iso(r.completed_at),
  };
}

function mapPart(r) {
  return {
    id: num(r.id), name: r.name, category: r.category, unit: r.unit,
    stock: num(r.stock), minStock: num(r.min_stock), notes: r.notes, active: r.active,
    low: r.active && num(r.stock) <= num(r.min_stock),
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  };
}

function mapRule(r) {
  return {
    id: num(r.id), name: r.name, type: r.type, everyDays: num(r.every_days), leadDays: num(r.lead_days),
    scope: r.scope, scopeId: r.scope_id == null ? null : num(r.scope_id), assignee: r.assignee,
    notify: r.notify, active: r.active, startsAt: iso(r.starts_at), lastRunAt: iso(r.last_run_at),
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  };
}

async function getChecklists() {
  const row = await prisma.systemConfig.findUnique({ where: { key: 'maintenance_checklists' } });
  const custom = json(row?.value, {}) || {};
  const out = {};
  for (const t of Object.keys(TYPES)) {
    out[t] = Array.isArray(custom[t]) ? custom[t].map(String).filter(Boolean) : DEFAULT_CHECKLISTS[t];
  }
  return out;
}

async function checklistFor(type) {
  const all = await getChecklists();
  return (all[type] || []).map((label) => ({ label, done: false }));
}

// --- Estado "en taller" -------------------------------------------------
// Una orden con workshop=true abierta pone la tablet en 'mantenimiento' (si
// estaba 'activa' — nunca pisa un 'bloqueada'). Al cerrarse la última orden
// de taller abierta, vuelve a 'activa'.
async function applyWorkshop(tabletId) {
  if (!tabletId) return;
  const tablet = await prisma.tablet.findUnique({ where: { id: tabletId }, select: { manualStatus: true } });
  if (!tablet) return;
  const [{ n }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM maintenance_orders WHERE tablet_id = $1 AND workshop = true AND status = ANY($2::text[])`,
    tabletId, OPEN,
  );
  if (n > 0 && tablet.manualStatus === 'activa') {
    await prisma.tablet.update({ where: { id: tabletId }, data: { manualStatus: 'mantenimiento' } });
  } else if (n === 0 && tablet.manualStatus === 'mantenimiento') {
    await prisma.tablet.update({ where: { id: tabletId }, data: { manualStatus: 'activa' } });
  }
}

// --- Órdenes ------------------------------------------------------------
async function getOrder(id) {
  const rows = await prisma.$queryRawUnsafe(`SELECT * FROM maintenance_orders WHERE id = $1`, id);
  return rows[0] ? mapOrder(rows[0]) : null;
}

async function listOrders({ status, tabletId, from, to, limit } = {}) {
  const where = [];
  const params = [];
  if (status === 'abiertas') { params.push(OPEN); where.push(`status = ANY($${params.length}::text[])`); }
  else if (status && STATUSES.includes(status)) { params.push(status); where.push(`status = $${params.length}`); }
  if (tabletId) { params.push(tabletId); where.push(`tablet_id = $${params.length}`); }
  if (from) { params.push(from); where.push(`scheduled_for >= $${params.length}::timestamptz`); }
  if (to) { params.push(to); where.push(`scheduled_for <= $${params.length}::timestamptz`); }
  params.push(Math.min(Math.max(parseInt(limit) || 500, 1), 2000));
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM maintenance_orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY CASE WHEN status IN ('pendiente','en_curso') THEN 0 ELSE 1 END,
              scheduled_for ASC NULLS LAST, id DESC
     LIMIT $${params.length}`,
    ...params,
  );
  return rows.map(mapOrder);
}

async function createOrder(data, user) {
  const tablet = data.tabletId
    ? await prisma.tablet.findUnique({ where: { id: data.tabletId }, select: { id: true, name: true } })
    : null;
  if (data.tabletId && !tablet) { const e = new Error('Tablet no encontrada'); e.status = 404; throw e; }
  const type = TYPES[data.type] ? data.type : 'revision';
  const checklist = Array.isArray(data.checklist) ? data.checklist : await checklistFor(type);
  const title = (data.title || '').trim() || `${TYPES[type]}${tablet ? ` — ${tablet.name}` : ''}`;
  const status = STATUSES.includes(data.status) ? data.status : 'pendiente';
  const rows = await prisma.$queryRawUnsafe(
    `INSERT INTO maintenance_orders
       (tablet_id, tablet_name, type, title, status, priority, scheduled_for, assignee, notes, resolution,
        checklist, workshop, source, alert_code, rule_id, created_by, started_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16,
        CASE WHEN $5 IN ('en_curso','hecha') THEN NOW() END, CASE WHEN $5 = 'hecha' THEN NOW() END)
     RETURNING *`,
    tablet?.id ?? null, tablet?.name ?? null, type, title, status,
    PRIORITIES.includes(data.priority) ? data.priority : 'normal',
    data.scheduledFor || null, data.assignee || null, data.notes || null, data.resolution || null,
    JSON.stringify(checklist), !!data.workshop, data.source || 'manual', data.alertCode || null,
    data.ruleId || null, user?.name || user?.email || data.createdBy || null,
  );
  const order = mapOrder(rows[0]);
  if (order.workshop) await applyWorkshop(order.tabletId);
  return order;
}

// Descuenta del stock los repuestos usados (una sola vez por orden).
async function applyParts(order, user) {
  if (order.partsApplied || !order.parts.length) return;
  await prisma.$transaction(async (tx) => {
    // Re-chequeo dentro de la transacción: dos "hecha" simultáneos no
    // descuentan dos veces.
    const claimed = await tx.$queryRawUnsafe(
      `UPDATE maintenance_orders SET parts_applied = true WHERE id = $1 AND parts_applied = false RETURNING id`, order.id,
    );
    if (!claimed.length) return;
    for (const p of order.parts) {
      const qty = parseInt(p.qty);
      if (!p.partId || !(qty > 0)) continue;
      await tx.$executeRawUnsafe(`UPDATE maintenance_parts SET stock = stock - $1, updated_at = NOW() WHERE id = $2`, qty, p.partId);
      await tx.$executeRawUnsafe(
        `INSERT INTO maintenance_part_moves (part_id, delta, reason, order_id, created_by) VALUES ($1, $2, $3, $4, $5)`,
        p.partId, -qty, `Orden #${order.id}${order.tabletName ? ` (${order.tabletName})` : ''}`, order.id, user?.name || null,
      );
    }
  });
  await checkLowStock(order.parts.map((p) => p.partId));
}

async function updateOrder(id, data, user) {
  const before = await getOrder(id);
  if (!before) return null;
  const sets = [];
  const params = [];
  const set = (col, val, cast = '') => { params.push(val); sets.push(`${col} = $${params.length}${cast}`); };
  if (data.title !== undefined) set('title', String(data.title).trim() || before.title);
  if (data.type !== undefined && TYPES[data.type]) set('type', data.type);
  if (data.priority !== undefined && PRIORITIES.includes(data.priority)) set('priority', data.priority);
  if (data.scheduledFor !== undefined) set('scheduled_for', data.scheduledFor || null, '::timestamptz');
  if (data.assignee !== undefined) set('assignee', data.assignee || null);
  if (data.notes !== undefined) set('notes', data.notes || null);
  if (data.resolution !== undefined) set('resolution', data.resolution || null);
  if (data.workshop !== undefined) set('workshop', !!data.workshop);
  if (Array.isArray(data.checklist)) {
    set('checklist', JSON.stringify(data.checklist.map((c) => ({ label: String(c.label || ''), done: !!c.done })).filter((c) => c.label)), '::jsonb');
  }
  if (Array.isArray(data.photos)) {
    set('photos', JSON.stringify(data.photos.filter((p) => p && typeof p.url === 'string').map((p) => ({
      url: p.url, key: p.key || null, kind: ['antes', 'despues', 'otra'].includes(p.kind) ? p.kind : 'otra', at: p.at || new Date().toISOString(),
    }))), '::jsonb');
  }
  // Los repuestos ya descontados no se pueden editar (el stock ya se movió).
  if (Array.isArray(data.parts) && !before.partsApplied) {
    set('parts', JSON.stringify(data.parts.map((p) => ({ partId: parseInt(p.partId), qty: parseInt(p.qty) || 1, name: p.name || null }))
      .filter((p) => p.partId > 0)), '::jsonb');
  }
  if (data.status !== undefined && STATUSES.includes(data.status) && data.status !== before.status) {
    set('status', data.status);
    if (data.status === 'en_curso' && !before.startedAt) sets.push('started_at = NOW()');
    if (data.status === 'hecha') sets.push('completed_at = NOW()');
    if (OPEN.includes(data.status)) sets.push('completed_at = NULL');
  }
  if (!sets.length) return before;
  sets.push('updated_at = NOW()');
  params.push(id);
  await prisma.$executeRawUnsafe(`UPDATE maintenance_orders SET ${sets.join(', ')} WHERE id = $${params.length}`, ...params);
  let order = await getOrder(id);
  if (order.status === 'hecha' && !order.partsApplied) {
    await applyParts(order, user);
    order = await getOrder(id);
  }
  if (before.workshop || order.workshop || data.status !== undefined) await applyWorkshop(order.tabletId);
  return order;
}

// --- Repuestos ----------------------------------------------------------
// Avisa (WhatsApp/webhook) cuando un repuesto recién movido queda en o por
// debajo de su mínimo. Sólo mira los ids tocados: un reinicio del server no
// re-avisa todo el inventario.
const lowStockAlerted = new Set();
async function checkLowStock(partIds) {
  try {
    const ids = (partIds || []).map(Number).filter(Boolean);
    if (!ids.length) return;
    const rows = await prisma.$queryRawUnsafe(`SELECT * FROM maintenance_parts WHERE active = true AND id = ANY($1::int[])`, ids);
    const newlyLow = [];
    for (const r of rows.map(mapPart)) {
      if (r.low && !lowStockAlerted.has(r.id)) { lowStockAlerted.add(r.id); newlyLow.push(r); }
      else if (!r.low) lowStockAlerted.delete(r.id);
    }
    if (newlyLow.length) {
      await notifyChannels('Repuestos por agotarse',
        `Quedan pocos repuestos: ${newlyLow.map((p) => `${p.name} (${p.stock} ${p.unit}, mínimo ${p.minStock})`).join(', ')}.`,
        { eventType: 'MAINT_LOW_STOCK', webhookEvent: 'maintenance_low_stock' });
    }
  } catch (err) { console.warn('[maint-low-stock]', err.message); }
}

async function movePart(partId, delta, reason, user) {
  const d = parseInt(delta);
  if (!Number.isFinite(d) || d === 0) { const e = new Error('Cantidad inválida'); e.status = 400; throw e; }
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`UPDATE maintenance_parts SET stock = stock + $1, updated_at = NOW() WHERE id = $2`, d, partId),
    prisma.$executeRawUnsafe(
      `INSERT INTO maintenance_part_moves (part_id, delta, reason, created_by) VALUES ($1, $2, $3, $4)`,
      partId, d, reason || (d > 0 ? 'Entrada' : 'Salida'), user?.name || null,
    ),
  ]);
  await checkLowStock([partId]);
  const rows = await prisma.$queryRawUnsafe(`SELECT * FROM maintenance_parts WHERE id = $1`, partId);
  return rows[0] ? mapPart(rows[0]) : null;
}

// --- Alertas ------------------------------------------------------------
// "1.46" < "1.47" < "1.100" (compara número por número, no como texto).
function olderVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
  }
  return false;
}

// Se calculan en el momento con lo que ya reportan las tablets. Las que están
// en taller o bloqueadas no generan alertas (están así a propósito).
async function computeAlerts() {
  const now = Date.now();
  const [tablets, cfgRows, errorRows, openOrders, partRows] = await Promise.all([
    prisma.tablet.findMany({
      select: {
        id: true, name: true, zone: true, lastSync: true, playlistId: true, playerOk: true, onFallback: true,
        batteryLevel: true, temperatureC: true, appVersion: true, manualStatus: true, maintenanceUntil: true,
        driverName: true, licensePlate: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.systemConfig.findMany({ where: { key: { in: ['battery_alert_pct', 'apk_version_name'] } } }),
    prisma.$queryRawUnsafe(
      `SELECT tablet_id, COUNT(*)::int AS n FROM error_logs WHERE created_at > NOW() - INTERVAL '24 hours' GROUP BY tablet_id`,
    ),
    prisma.$queryRawUnsafe(
      `SELECT id, tablet_id, alert_code, status FROM maintenance_orders WHERE status = ANY($1::text[]) AND tablet_id IS NOT NULL`, OPEN,
    ),
    prisma.$queryRawUnsafe(`SELECT * FROM maintenance_parts WHERE active = true AND stock <= min_stock ORDER BY name`),
  ]);
  const cfg = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]));
  const batteryThreshold = Math.min(Math.max(parseInt(cfg.battery_alert_pct) || 20, 5), 90);
  const publishedVersion = cfg.apk_version_name || null;
  const errors = Object.fromEntries(errorRows.map((r) => [num(r.tablet_id), num(r.n)]));
  const ordersByTablet = {};
  for (const o of openOrders) (ordersByTablet[num(o.tablet_id)] ||= []).push({ id: num(o.id), alertCode: o.alert_code, status: o.status });

  const alerts = [];
  const workshop = [];
  for (const t of tablets) {
    if (t.manualStatus === 'mantenimiento') { workshop.push({ id: t.id, name: t.name, zone: t.zone }); continue; }
    if (t.manualStatus === 'bloqueada') continue;
    const syncMs = t.lastSync ? new Date(t.lastSync).getTime() : null;
    const offMin = syncMs ? (now - syncMs) / 60000 : Infinity;
    const online = offMin < 20;
    const recent = offMin < 7 * 1440;
    const push = (code, level, label, detail) => {
      const orders = ordersByTablet[t.id] || [];
      const order = orders.find((o) => o.alertCode === code) || null;
      alerts.push({
        code, level, label, detail, tabletId: t.id, tabletName: t.name, zone: t.zone,
        driverName: t.driverName, licensePlate: t.licensePlate,
        suggestedType: ALERT_ORDER_TYPE[code] || 'revision',
        orderId: order?.id ?? null, openOrders: orders.length,
      });
    };
    const ago = (min) => (min < 120 ? `${Math.round(min)} min` : min < 2880 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} días`);

    if (!syncMs) push('sin_sync_nunca', 'warn', 'Nunca sincronizó', 'Se dio de alta pero nunca se conectó.');
    else if (offMin >= 7 * 1440) push('offline_largo', 'danger', `Sin conexión hace ${ago(offMin)}`, 'Más de una semana sin conectarse. Revisar en persona.');
    else if (offMin >= 1440) push('offline', 'warn', `Sin conexión hace ${ago(offMin)}`, 'Más de 24 h sin conectarse (de noche es normal que esté apagada).');

    if (online && t.playlistId && t.onFallback === true) push('fallback', 'danger', 'Muestra el video de respaldo', 'No logró cargar su playlist.');
    else if (online && t.playlistId && t.playerOk === false) push('no_reproduce', 'danger', 'No reproduce publicidad', 'Está conectada pero el reproductor no muestra anuncios.');
    if (online && t.batteryLevel != null && t.batteryLevel <= batteryThreshold) push('bateria', 'warn', `Batería al ${t.batteryLevel}%`, 'Revisar cable y cargador del taxi.');
    if (recent && t.temperatureC != null && t.temperatureC >= 45) push('temperatura', 'warn', `Temperatura ${Math.round(t.temperatureC)} °C`, 'Puede estar al sol o sin ventilación.');
    if (recent && publishedVersion && t.appVersion && olderVersion(t.appVersion, publishedVersion)) push('version', 'info', `App v${t.appVersion} (publicada v${publishedVersion})`, 'No se actualizó a la última versión.');
    if ((errors[t.id] || 0) >= 20) push('errores', 'warn', `${errors[t.id]} errores en 24 h`, 'La app reportó muchos errores.');
    if (t.maintenanceUntil && new Date(t.maintenanceUntil).getTime() < now) push('fecha_vencida', 'warn', 'Fecha de mantenimiento vencida', `Cargada en la tablet: ${new Date(t.maintenanceUntil).toLocaleDateString('es-UY')}.`);
  }
  const rank = { danger: 0, warn: 1, info: 2 };
  alerts.sort((a, b) => rank[a.level] - rank[b.level] || a.tabletName.localeCompare(b.tabletName));
  return { alerts, workshop, lowStock: partRows.map(mapPart), batteryThreshold, publishedVersion };
}

// --- Reglas recurrentes ---------------------------------------------------
// Primera orden: en starts_at. Siguientes: every_days después de completar la
// anterior de esa misma regla y tablet. La orden se crea lead_days antes de la
// fecha. Nunca hay dos órdenes abiertas de la misma regla para la misma tablet.
async function runRules({ ruleId } = {}) {
  const rules = (await prisma.$queryRawUnsafe(
    `SELECT * FROM maintenance_rules WHERE active = true ${ruleId ? 'AND id = $1' : ''}`, ...(ruleId ? [ruleId] : []),
  )).map(mapRule);
  const created = [];
  for (const rule of rules) {
    try {
      const where = rule.scope === 'group' && rule.scopeId ? { groupId: rule.scopeId }
        : rule.scope === 'tablet' && rule.scopeId ? { id: rule.scopeId } : {};
      const tablets = await prisma.tablet.findMany({ where, select: { id: true, name: true } });
      if (!tablets.length) continue;
      const state = await prisma.$queryRawUnsafe(
        `SELECT tablet_id,
                BOOL_OR(status IN ('pendiente','en_curso')) AS has_open,
                MAX(completed_at) FILTER (WHERE status = 'hecha') AS last_done
           FROM maintenance_orders WHERE rule_id = $1 AND tablet_id IS NOT NULL GROUP BY tablet_id`, rule.id,
      );
      const byTablet = Object.fromEntries(state.map((s) => [num(s.tablet_id), s]));
      const made = [];
      for (const t of tablets) {
        const s = byTablet[t.id];
        if (s?.has_open) continue;
        const due = s?.last_done
          ? new Date(new Date(s.last_done).getTime() + rule.everyDays * 86400000)
          : new Date(rule.startsAt);
        if (Date.now() < due.getTime() - rule.leadDays * 86400000) continue;
        const order = await createOrder({
          tabletId: t.id, type: rule.type, title: `${rule.name} — ${t.name}`, scheduledFor: due.toISOString(),
          assignee: rule.assignee, source: 'recurrente', ruleId: rule.id, createdBy: 'Regla automática',
        });
        made.push(order);
      }
      await prisma.$executeRawUnsafe(`UPDATE maintenance_rules SET last_run_at = NOW() WHERE id = $1`, rule.id);
      if (made.length && rule.notify) {
        const names = made.map((o) => o.tabletName).filter(Boolean);
        await notifyChannels('Mantenimiento programado',
          `Se programaron ${made.length} ${made.length === 1 ? 'orden' : 'órdenes'} de "${rule.name}"` +
          `${rule.assignee ? ` para ${rule.assignee}` : ''}: ${names.slice(0, 15).join(', ')}${names.length > 15 ? '…' : ''}.`,
          { eventType: 'MAINT_SCHEDULED', webhookEvent: 'maintenance_scheduled' });
      }
      created.push(...made);
    } catch (err) {
      console.warn(`[maint-rules] regla ${rule.id}:`, err.message);
    }
  }
  return created;
}

module.exports = {
  TYPES, STATUSES, OPEN, PRIORITIES, DEFAULT_CHECKLISTS,
  mapOrder, mapPart, mapRule, getChecklists, checklistFor, applyWorkshop,
  getOrder, listOrders, createOrder, updateOrder, applyParts,
  checkLowStock, movePart, computeAlerts, runRules,
};
