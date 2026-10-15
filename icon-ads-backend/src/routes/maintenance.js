const router = require('express').Router();
const path = require('path');
const prisma = require('../lib/prisma');
const r2 = require('../lib/r2');
const firebaseAdmin = require('../lib/firebase-admin');
const forceSyncFlags = require('../lib/forceSyncFlags');
const diagnosticFlags = require('../lib/diagnosticFlags');
const { audit } = require('../lib/auditLog');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const m = require('../lib/maintenance');

// Lectura: cualquier usuario logueado. Escritura: admin / superadmin.
router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid id' });
  next();
});

const int = (v) => (v == null || v === '' ? null : parseInt(v, 10));

// GET /api/maintenance/meta — tipos, estados, prioridades y checklists.
router.get('/meta', async (req, res, next) => {
  try {
    res.json({ types: m.TYPES, statuses: m.STATUSES, priorities: m.PRIORITIES, checklists: await m.getChecklists() });
  } catch (err) { next(err); }
});

// PUT /api/maintenance/checklists — { tipo: [ítems] }
router.put('/checklists', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const clean = {};
    for (const t of Object.keys(m.TYPES)) {
      if (Array.isArray(body[t])) clean[t] = body[t].map((s) => String(s).trim()).filter(Boolean).slice(0, 40);
    }
    const value = JSON.stringify(clean);
    await prisma.systemConfig.upsert({ where: { key: 'maintenance_checklists' }, update: { value }, create: { key: 'maintenance_checklists', value } });
    audit(req, 'MAINT_CHECKLISTS_UPDATE', 'maintenance', null, 'Checklists actualizados');
    res.json(await m.getChecklists());
  } catch (err) { next(err); }
});

// ── Alertas ────────────────────────────────────────────────────────────
router.get('/alerts', async (req, res, next) => {
  try { res.json(await m.computeAlerts()); } catch (err) { next(err); }
});

// ── Órdenes ────────────────────────────────────────────────────────────
router.get('/orders', async (req, res, next) => {
  try {
    res.json(await m.listOrders({
      status: req.query.status, tabletId: int(req.query.tabletId),
      from: req.query.from, to: req.query.to, limit: req.query.limit,
    }));
  } catch (err) { next(err); }
});

router.get('/orders/:id', async (req, res, next) => {
  try {
    const order = await m.getOrder(Number(req.params.id));
    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
    res.json(order);
  } catch (err) { next(err); }
});

// POST /api/maintenance/orders — una orden por tablet (tabletIds: [...]),
// o una sola sin tablet.
router.post('/orders', requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const ids = Array.isArray(b.tabletIds) && b.tabletIds.length
      ? [...new Set(b.tabletIds.map(int).filter(Boolean))]
      : [int(b.tabletId)];
    if (ids.length > 200) return res.status(400).json({ error: 'Demasiadas tablets' });
    const created = [];
    for (const tabletId of ids) {
      created.push(await m.createOrder({ ...b, tabletId, title: ids.length > 1 ? '' : b.title }, req.user));
    }
    audit(req, 'MAINT_ORDER_CREATE', 'maintenance', created[0]?.id ?? null,
      `${created.length} orden(es) ${m.TYPES[created[0]?.type] || ''}: ${created.map((o) => o.tabletName || `#${o.id}`).join(', ')}`);
    res.status(201).json(created);
  } catch (err) { next(err); }
});

router.patch('/orders/:id', requireAdmin, async (req, res, next) => {
  try {
    const order = await m.updateOrder(Number(req.params.id), req.body || {}, req.user);
    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
    if (req.body?.status) audit(req, 'MAINT_ORDER_STATUS', 'maintenance', order.id, `#${order.id} → ${order.status}`);
    res.json(order);
  } catch (err) { next(err); }
});

// GET /api/maintenance/photo-presign?filename=&contentType= — subida directa a R2.
router.get('/photo-presign', requireAdmin, async (req, res, next) => {
  try {
    const { filename, contentType } = req.query;
    if (!filename || !contentType) return res.status(400).json({ error: 'filename and contentType required' });
    if (!/\.(jpe?g|png|webp)$/i.test(filename) || !/^image\/(jpeg|png|webp)$/.test(contentType)) {
      return res.status(400).json({ error: 'Sólo fotos JPG, PNG o WebP' });
    }
    if (!r2.isConfigured) return res.status(503).json({ error: 'Almacenamiento de fotos no configurado' });
    const key = `maintenance/${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(filename).toLowerCase()}`;
    res.json({ uploadUrl: await r2.getPresignedUploadUrl(key, contentType), key, publicUrl: r2.getPublicUrl(key) });
  } catch (err) { next(err); }
});

// ── Tablet: historial y diagnóstico ────────────────────────────────────
router.get('/tablets/:id/history', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [orders, diagnostics] = await Promise.all([
      m.listOrders({ tabletId: id, limit: 200 }),
      prisma.$queryRawUnsafe(`SELECT id, data, created_at FROM tablet_diagnostics WHERE tablet_id = $1 ORDER BY created_at DESC LIMIT 10`, id),
    ]);
    res.json({ orders, diagnostics: diagnostics.map((d) => ({ id: Number(d.id), data: d.data, createdAt: d.created_at })) });
  } catch (err) { next(err); }
});

// Diagnóstico = lo que la tablet ya reporta en cada sync + errores/syncs
// recientes + (si la app es >= 1.48) el último diagnóstico completo pedido.
router.get('/tablets/:id/diagnostic', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const tablet = await prisma.tablet.findUnique({
      where: { id },
      select: {
        id: true, name: true, zone: true, lastSync: true, lastIp: true, batteryLevel: true, temperatureC: true,
        appVersion: true, osVersion: true, deviceModel: true, serial: true, brightness: true, brightnessAuto: true,
        playerOk: true, onFallback: true, lastAdAgoS: true, manualStatus: true, playlistId: true,
        playlist: { select: { id: true, name: true, version: true } }, lastScreenshotAt: true,
      },
    });
    if (!tablet) return res.status(404).json({ error: 'Tablet no encontrada' });
    const [errors, syncs, last] = await Promise.all([
      prisma.errorLog.findMany({ where: { tabletId: id }, orderBy: { occurredAt: 'desc' }, take: 10, select: { errorType: true, message: true, occurredAt: true } }),
      prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE success = false)::int AS failed FROM sync_logs WHERE tablet_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`, id,
      ),
      prisma.$queryRawUnsafe(`SELECT data, created_at FROM tablet_diagnostics WHERE tablet_id = $1 ORDER BY created_at DESC LIMIT 1`, id),
    ]);
    res.json({
      tablet,
      errors,
      syncs24h: { total: Number(syncs[0]?.total || 0), failed: Number(syncs[0]?.failed || 0) },
      full: last[0] ? { data: last[0].data, at: last[0].created_at } : null,
      pending: diagnosticFlags.has(id),
      supportsFull: supportsDiagnostic(tablet.appVersion),
    });
  } catch (err) { next(err); }
});

function supportsDiagnostic(appVersion) {
  const [maj, min] = String(appVersion || '').split('.').map((n) => parseInt(n, 10));
  return Number.isFinite(maj) && (maj > 1 || (maj === 1 && min >= 48));
}

router.post('/tablets/:id/diagnostic', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const tablet = await prisma.tablet.findUnique({ where: { id }, select: { id: true, name: true, fcmToken: true, appVersion: true } });
    if (!tablet) return res.status(404).json({ error: 'Tablet no encontrada' });
    diagnosticFlags.add(id);
    if (tablet.fcmToken) firebaseAdmin.sendSyncPush([tablet.fcmToken]).catch(() => {});
    res.json({
      ok: true,
      message: supportsDiagnostic(tablet.appVersion)
        ? `Pedido enviado a ${tablet.name}. Llega en su próxima conexión.`
        : `${tablet.name} tiene la app v${tablet.appVersion || '?'}: el diagnóstico completo necesita la v1.48 o más nueva. Queda pedido para cuando se actualice.`,
    });
  } catch (err) { next(err); }
});

// ── Cambio de tablet (reserva ocupa el lugar de la rota) ───────────────
// La de reserva toma nombre, playlist, zona, grupo, taxista, matrícula,
// precio, giro y zona horaria. La vieja queda "en taller" con una orden de
// revisión abierta. Nada se borra: métricas e historial siguen en cada una.
router.post('/swap', requireAdmin, async (req, res, next) => {
  try {
    const fromId = int(req.body?.fromId);
    const toId = int(req.body?.toId);
    if (!fromId || !toId || fromId === toId) return res.status(400).json({ error: 'Elegí la tablet a reemplazar y la de reserva' });
    const [from, to] = await Promise.all([
      prisma.tablet.findUnique({ where: { id: fromId } }),
      prisma.tablet.findUnique({ where: { id: toId } }),
    ]);
    if (!from || !to) return res.status(404).json({ error: 'Tablet no encontrada' });

    const oldName = from.name;
    const spareName = to.name;
    const workshopName = /\(taller\)$/.test(oldName) ? oldName : `${oldName} (taller)`;
    await prisma.$transaction([
      prisma.tablet.update({ where: { id: from.id }, data: { name: workshopName, manualStatus: from.manualStatus === 'bloqueada' ? 'bloqueada' : 'mantenimiento' } }),
      prisma.tablet.update({
        where: { id: to.id },
        data: {
          name: oldName, zone: from.zone, timezone: from.timezone, playlistId: from.playlistId, groupId: from.groupId,
          driverName: from.driverName, licensePlate: from.licensePlate, spotPrice: from.spotPrice, rotated180: from.rotated180,
          manualStatus: 'activa',
        },
      }),
    ]);

    const note = (req.body?.note || '').trim();
    const done = await m.createOrder({
      tabletId: to.id, type: 'reemplazo', status: 'hecha', title: `Reemplazo — ${oldName}`,
      notes: `"${spareName}" (serie ${to.serial || '?'}) reemplaza a "${oldName}" (serie ${from.serial || '?'}).${note ? `\n${note}` : ''}`,
      checklist: (await m.checklistFor('reemplazo')).map((c) => ({ ...c, done: true })),
    }, req.user);
    const repair = await m.createOrder({
      tabletId: from.id, type: 'revision', title: `Revisión en taller — ${oldName}`, workshop: true,
      notes: `Sacada del taxi y reemplazada por "${spareName}" (orden #${done.id}).${note ? `\n${note}` : ''}`,
    }, req.user);
    // Si se pidió desde una orden, se cierra con referencia al cambio.
    if (int(req.body?.orderId)) {
      await m.updateOrder(int(req.body.orderId), { status: 'hecha', resolution: `Tablet reemplazada por "${spareName}" (orden #${done.id}).` }, req.user);
    }

    forceSyncFlags.add(to.id);
    if (to.fcmToken) firebaseAdmin.sendSyncPush([to.fcmToken]).catch(() => {});
    audit(req, 'MAINT_SWAP', 'tablet', to.id, `"${spareName}" reemplaza a "${oldName}" (#${from.id} → taller)`);
    res.json({
      ok: true, doneOrder: done, repairOrder: repair,
      message: `"${spareName}" ahora es "${oldName}" y baja su playlist en la próxima conexión. La vieja quedó como "${workshopName}", en taller.`,
    });
  } catch (err) { next(err); }
});

// ── Repuestos ──────────────────────────────────────────────────────────
router.get('/parts', async (req, res, next) => {
  try {
    const rows = await prisma.$queryRawUnsafe(`SELECT * FROM maintenance_parts ORDER BY active DESC, name ASC`);
    res.json(rows.map(m.mapPart));
  } catch (err) { next(err); }
});

router.post('/parts', requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Falta el nombre' });
    const rows = await prisma.$queryRawUnsafe(
      `INSERT INTO maintenance_parts (name, category, unit, stock, min_stock, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      name, b.category || null, String(b.unit || 'u').trim() || 'u', int(b.stock) || 0, Math.max(int(b.minStock) || 0, 0), b.notes || null,
    );
    const part = m.mapPart(rows[0]);
    if (part.stock) {
      await prisma.$executeRawUnsafe(`INSERT INTO maintenance_part_moves (part_id, delta, reason, created_by) VALUES ($1, $2, 'Stock inicial', $3)`, part.id, part.stock, req.user?.name || null);
    }
    audit(req, 'MAINT_PART_CREATE', 'maintenance', part.id, name);
    await m.checkLowStock([part.id]);
    res.status(201).json(part);
  } catch (err) { next(err); }
});

// PATCH /api/maintenance/parts/:id — datos y mínimo. El stock se mueve sólo
// con /move (queda registrado). active=false archiva (no borra).
router.patch('/parts/:id', requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const sets = [];
    const params = [];
    const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (b.name !== undefined && String(b.name).trim()) set('name', String(b.name).trim());
    if (b.category !== undefined) set('category', b.category || null);
    if (b.unit !== undefined) set('unit', String(b.unit || 'u').trim() || 'u');
    if (b.minStock !== undefined) set('min_stock', Math.max(int(b.minStock) || 0, 0));
    if (b.notes !== undefined) set('notes', b.notes || null);
    if (b.active !== undefined) set('active', !!b.active);
    if (sets.length) {
      params.push(Number(req.params.id));
      await prisma.$executeRawUnsafe(`UPDATE maintenance_parts SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`, ...params);
    }
    const rows = await prisma.$queryRawUnsafe(`SELECT * FROM maintenance_parts WHERE id = $1`, Number(req.params.id));
    if (!rows[0]) return res.status(404).json({ error: 'Repuesto no encontrado' });
    await m.checkLowStock([rows[0].id]);
    res.json(m.mapPart(rows[0]));
  } catch (err) { next(err); }
});

router.post('/parts/:id/move', requireAdmin, async (req, res, next) => {
  try {
    const part = await m.movePart(Number(req.params.id), req.body?.delta, req.body?.reason, req.user);
    if (!part) return res.status(404).json({ error: 'Repuesto no encontrado' });
    audit(req, 'MAINT_PART_MOVE', 'maintenance', part.id, `${part.name}: ${req.body?.delta > 0 ? '+' : ''}${req.body?.delta}`);
    res.json(part);
  } catch (err) { next(err); }
});

router.get('/parts/:id/moves', async (req, res, next) => {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, delta, reason, order_id, created_by, created_at FROM maintenance_part_moves WHERE part_id = $1 ORDER BY created_at DESC LIMIT 100`,
      Number(req.params.id),
    );
    res.json(rows.map((r) => ({
      id: Number(r.id), delta: Number(r.delta), reason: r.reason, orderId: r.order_id == null ? null : Number(r.order_id),
      createdBy: r.created_by, createdAt: r.created_at,
    })));
  } catch (err) { next(err); }
});

// ── Reglas recurrentes ─────────────────────────────────────────────────
router.get('/rules', async (req, res, next) => {
  try {
    const rows = await prisma.$queryRawUnsafe(`SELECT * FROM maintenance_rules ORDER BY active DESC, name ASC`);
    res.json(rows.map(m.mapRule));
  } catch (err) { next(err); }
});

function ruleInput(b) {
  const everyDays = int(b.everyDays);
  const leadDays = int(b.leadDays);
  const scope = ['all', 'group', 'tablet'].includes(b.scope) ? b.scope : 'all';
  return {
    name: String(b.name || '').trim(),
    type: m.TYPES[b.type] ? b.type : 'revision',
    everyDays,
    leadDays: Number.isFinite(leadDays) ? Math.min(Math.max(leadDays, 0), 60) : 3,
    scope,
    scopeId: scope === 'all' ? null : int(b.scopeId),
    assignee: b.assignee || null,
    notify: b.notify !== false,
    startsAt: b.startsAt || new Date().toISOString(),
  };
}

router.post('/rules', requireAdmin, async (req, res, next) => {
  try {
    const r = ruleInput(req.body || {});
    if (!r.name) return res.status(400).json({ error: 'Falta el nombre' });
    if (!(r.everyDays >= 1 && r.everyDays <= 730)) return res.status(400).json({ error: 'La frecuencia va de 1 a 730 días' });
    if (r.scope !== 'all' && !r.scopeId) return res.status(400).json({ error: 'Elegí el grupo o la tablet' });
    const rows = await prisma.$queryRawUnsafe(
      `INSERT INTO maintenance_rules (name, type, every_days, lead_days, scope, scope_id, assignee, notify, starts_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz) RETURNING *`,
      r.name, r.type, r.everyDays, r.leadDays, r.scope, r.scopeId, r.assignee, r.notify, r.startsAt,
    );
    const rule = m.mapRule(rows[0]);
    audit(req, 'MAINT_RULE_CREATE', 'maintenance', rule.id, `${rule.name} cada ${rule.everyDays} días`);
    const created = await m.runRules({ ruleId: rule.id });
    res.status(201).json({ rule, created: created.length });
  } catch (err) { next(err); }
});

// PATCH /api/maintenance/rules/:id — active=false pausa la regla (no se borra;
// sus órdenes ya creadas quedan).
router.patch('/rules/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const rows = await prisma.$queryRawUnsafe(`SELECT * FROM maintenance_rules WHERE id = $1`, id);
    if (!rows[0]) return res.status(404).json({ error: 'Regla no encontrada' });
    const cur = m.mapRule(rows[0]);
    const r = ruleInput({ ...cur, ...req.body });
    if (!r.name) return res.status(400).json({ error: 'Falta el nombre' });
    if (!(r.everyDays >= 1 && r.everyDays <= 730)) return res.status(400).json({ error: 'La frecuencia va de 1 a 730 días' });
    const active = req.body?.active !== undefined ? !!req.body.active : cur.active;
    const out = await prisma.$queryRawUnsafe(
      `UPDATE maintenance_rules SET name = $1, type = $2, every_days = $3, lead_days = $4, scope = $5, scope_id = $6,
         assignee = $7, notify = $8, starts_at = $9::timestamptz, active = $10, updated_at = NOW() WHERE id = $11 RETURNING *`,
      r.name, r.type, r.everyDays, r.leadDays, r.scope, r.scopeId, r.assignee, r.notify, r.startsAt, active, id,
    );
    const rule = m.mapRule(out[0]);
    const created = rule.active ? await m.runRules({ ruleId: rule.id }) : [];
    res.json({ rule, created: created.length });
  } catch (err) { next(err); }
});

router.post('/rules/run', requireAdmin, async (req, res, next) => {
  try {
    const created = await m.runRules();
    res.json({ ok: true, created: created.length });
  } catch (err) { next(err); }
});

module.exports = router;
