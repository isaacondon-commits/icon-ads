/**
 * Startup migration: adds columns that prisma db push can't apply when DIRECT_URL
 * is missing (PgBouncer transaction-mode pooler doesn't support full schema migrations).
 * ALTER TABLE ... ADD COLUMN IF NOT EXISTS is DDL-safe through PgBouncer.
 */
const prisma = require('./prisma');

const MIGRATIONS = [
  // Original missing columns (DIRECT_URL not set on Render)
  { name: 'tablets.notes',              sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS notes TEXT` },
  { name: 'tablets.maintenance_until',  sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS maintenance_until TIMESTAMPTZ` },
  // v2 — content management fields
  { name: 'ads.priority',               sql: `ALTER TABLE ads ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0` },
  { name: 'ads.target_url',             sql: `ALTER TABLE ads ADD COLUMN IF NOT EXISTS target_url TEXT` },
  { name: 'ads.starts_at',              sql: `ALTER TABLE ads ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ` },
  { name: 'ads.ends_at',                sql: `ALTER TABLE ads ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ` },
  // v2 — tablet vehicle info
  { name: 'tablets.driver_name',        sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS driver_name TEXT` },
  { name: 'tablets.license_plate',      sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS license_plate TEXT` },
  // v2 — client fiscal info
  { name: 'clients.rut',                sql: `ALTER TABLE clients ADD COLUMN IF NOT EXISTS rut TEXT` },
  { name: 'clients.address',            sql: `ALTER TABLE clients ADD COLUMN IF NOT EXISTS address TEXT` },
  // v2 — account lockout
  { name: 'users.failed_logins',        sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_logins INT NOT NULL DEFAULT 0` },
  { name: 'users.locked_until',         sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ` },
  // v3 — client color, tablet extended fields
  { name: 'clients.color',              sql: `ALTER TABLE clients ADD COLUMN IF NOT EXISTS color TEXT` },
  { name: 'tablets.spot_price',         sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS spot_price FLOAT` },
  { name: 'tablets.battery_level',      sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS battery_level INT` },
  { name: 'tablets.temperature_c',      sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS temperature_c FLOAT` },
  { name: 'tablets.app_version',        sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS app_version TEXT` },
  // v4 — sync logs, admin messages, groups, impression limits, system config
  { name: 'sync_logs',                  sql: `CREATE TABLE IF NOT EXISTS sync_logs (id SERIAL PRIMARY KEY, tablet_id INT NOT NULL REFERENCES tablets(id) ON DELETE CASCADE, version INT NOT NULL DEFAULT 0, success BOOLEAN NOT NULL DEFAULT true, error_msg TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'sync_logs.idx',              sql: `CREATE INDEX IF NOT EXISTS sync_logs_tablet_idx ON sync_logs(tablet_id, created_at DESC)` },
  { name: 'tablet_messages',            sql: `CREATE TABLE IF NOT EXISTS tablet_messages (id SERIAL PRIMARY KEY, tablet_id INT NOT NULL REFERENCES tablets(id) ON DELETE CASCADE, message TEXT NOT NULL, shown BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'tablet_groups',              sql: `CREATE TABLE IF NOT EXISTS tablet_groups (id SERIAL PRIMARY KEY, name TEXT NOT NULL, playlist_id INT REFERENCES playlists(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'tablets.group_id',           sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS group_id INT REFERENCES tablet_groups(id) ON DELETE SET NULL` },
  { name: 'system_config',              sql: `CREATE TABLE IF NOT EXISTS system_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  // v5 — new fields: campaign observations + budget, client commercial contact, tablet last_ip
  { name: 'clients.contact_name',      sql: `ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_name TEXT` },
  { name: 'clients.contact_phone',     sql: `ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_phone TEXT` },
  { name: 'tablets.last_ip',           sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS last_ip TEXT` },
  // v6 — tablet OS/model indicator (#2), campaign goals (#33)
  { name: 'tablets.os_version',        sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS os_version TEXT` },
  { name: 'tablets.device_model',      sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS device_model TEXT` },
  // v7 — ad tags (#16)
  { name: 'ads.tags',                  sql: `ALTER TABLE ads ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'` },
  // v8 — shared admin notes (#36)
  { name: 'admin_notes',               sql: `CREATE TABLE IF NOT EXISTS admin_notes (id SERIAL PRIMARY KEY, body TEXT NOT NULL, author_name TEXT NOT NULL DEFAULT 'Admin', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  // v9 — campaign templates (#31) + favorites (#44)
  { name: 'favorites',                 sql: `CREATE TABLE IF NOT EXISTS favorites (id SERIAL PRIMARY KEY, entity_type TEXT NOT NULL, entity_id INT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(entity_type, entity_id))` },
  // v10 — reminders (#39)
  { name: 'reminders',                 sql: `CREATE TABLE IF NOT EXISTS reminders (id SERIAL PRIMARY KEY, title TEXT NOT NULL, body TEXT, due_at TIMESTAMPTZ, done BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  // v11 — A/B tests (#49)
  { name: 'ab_tests',                  sql: `CREATE TABLE IF NOT EXISTS ab_tests (id SERIAL PRIMARY KEY, name TEXT NOT NULL, ad_a_id INT NOT NULL REFERENCES ads(id) ON DELETE CASCADE, ad_b_id INT NOT NULL REFERENCES ads(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'tablets.ab_group',          sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS ab_group TEXT` },
  // v12 — referrals (#58)
  { name: 'referrals',                 sql: `CREATE TABLE IF NOT EXISTS referrals (id SERIAL PRIMARY KEY, referrer_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, referred_id INT REFERENCES clients(id) ON DELETE SET NULL, code TEXT NOT NULL UNIQUE, used BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  // v13 — driver points (#69)
  { name: 'driver_points',             sql: `CREATE TABLE IF NOT EXISTS driver_points (id SERIAL PRIMARY KEY, tablet_id INT NOT NULL REFERENCES tablets(id) ON DELETE CASCADE UNIQUE, points INT NOT NULL DEFAULT 0, syncs_30d INT NOT NULL DEFAULT 0, last_calculated TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  // v14 — zones / geofencing (#67)
  { name: 'zones',                     sql: `CREATE TABLE IF NOT EXISTS zones (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT, polygon JSONB NOT NULL DEFAULT '[]', color TEXT NOT NULL DEFAULT '#3b82f6', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  // v15 — public API keys (#70)
  { name: 'api_keys',                  sql: `CREATE TABLE IF NOT EXISTS api_keys (id SERIAL PRIMARY KEY, name TEXT NOT NULL, key TEXT NOT NULL UNIQUE, active BOOLEAN NOT NULL DEFAULT true, last_used TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  // v16 — driver surveys (#47)
  { name: 'surveys',                   sql: `CREATE TABLE IF NOT EXISTS surveys (id SERIAL PRIMARY KEY, question TEXT NOT NULL, options JSONB NOT NULL DEFAULT '[]', active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'survey_answers',            sql: `CREATE TABLE IF NOT EXISTS survey_answers (id SERIAL PRIMARY KEY, survey_id INT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE, tablet_id INT NOT NULL REFERENCES tablets(id) ON DELETE CASCADE, option_index INT NOT NULL, answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(survey_id, tablet_id))` },
  // v18 — tablet manual status (activa / mantenimiento / bloqueada)
  { name: 'tablets.manual_status', sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS manual_status TEXT NOT NULL DEFAULT 'activa'` },
  // v17 — GPS real-time location
  { name: 'tablets.last_lat',          sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS last_lat FLOAT` },
  { name: 'tablets.last_lng',          sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS last_lng FLOAT` },
  { name: 'tablet_locations',          sql: `CREATE TABLE IF NOT EXISTS tablet_locations (id BIGSERIAL PRIMARY KEY, tablet_id INT NOT NULL REFERENCES tablets(id) ON DELETE CASCADE, lat FLOAT NOT NULL, lng FLOAT NOT NULL, accuracy FLOAT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'tablet_locations.idx',      sql: `CREATE INDEX IF NOT EXISTS tablet_locations_tablet_time ON tablet_locations(tablet_id, created_at DESC)` },
  // v19 — cascade-delete metrics/error_logs when a tablet is deleted (was RESTRICT,
  // blocked DELETE /api/tablets/:id with a 500 for any tablet that had reported data)
  { name: 'metrics.tablet_cascade',    sql: `ALTER TABLE metrics DROP CONSTRAINT IF EXISTS metrics_tablet_id_fkey` },
  { name: 'metrics.tablet_cascade.add', sql: `ALTER TABLE metrics ADD CONSTRAINT metrics_tablet_id_fkey FOREIGN KEY (tablet_id) REFERENCES tablets(id) ON DELETE CASCADE` },
  { name: 'error_logs.tablet_cascade', sql: `ALTER TABLE error_logs DROP CONSTRAINT IF EXISTS error_logs_tablet_id_fkey` },
  { name: 'error_logs.tablet_cascade.add', sql: `ALTER TABLE error_logs ADD CONSTRAINT error_logs_tablet_id_fkey FOREIGN KEY (tablet_id) REFERENCES tablets(id) ON DELETE CASCADE` },
  // v20 — FCM push token, for instant force-sync instead of waiting for the
  // periodic WorkManager poll
  { name: 'tablets.fcm_token',         sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS fcm_token TEXT` },
  // v21 — poster thumbnail for video ads (client-generated, best-effort)
  { name: 'ads.thumbnail_url',         sql: `ALTER TABLE ads ADD COLUMN IF NOT EXISTS thumbnail_url TEXT` },
  // v22 — manual 180° screen flip per tablet (charger connector can end up on
  // either side depending on how the mount was installed)
  { name: 'tablets.rotated_180',       sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS rotated_180 BOOLEAN NOT NULL DEFAULT false` },
  // v24 — brillo de pantalla reportado + nº de serie del hardware (para
  // identificar cada fila con su tablet física)
  { name: 'tablets.brightness',        sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS brightness INT` },
  { name: 'tablets.brightness_auto',   sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS brightness_auto BOOLEAN` },
  { name: 'tablets.serial',            sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS serial TEXT` },
  // v25 — salud del player + captura de pantalla on-demand
  { name: 'tablets.player_ok',         sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS player_ok BOOLEAN` },
  { name: 'tablets.last_ad_ago_s',     sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS last_ad_ago_s INT` },
  { name: 'tablets.last_screenshot',   sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS last_screenshot TEXT` },
  { name: 'tablets.last_screenshot_at', sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS last_screenshot_at TIMESTAMPTZ` },
  { name: 'tablets.on_fallback',       sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS on_fallback BOOLEAN` },
  { name: 'tablets.lux',               sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS lux DOUBLE PRECISION` },
  { name: 'tablets.light_sensor',      sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS light_sensor BOOLEAN` },
  // v23 — multiple clients per campaign (billing client stays campaigns.client_id;
  // this table holds additional clients associated with the campaign)
  // v24/v27 — Supabase Advisor: rls_disabled_in_public / sensitive_columns_exposed.
  // El lockdown COMPLETO de la API auto-generada (PostgREST) se hace en
  // hardenPublicSchema() abajo, en cada arranque: RLS en TODAS las tablas de
  // `public` (dinámico, no una lista) + REVOKE total a `anon`/`authenticated`.
  // v26 — la app vieja reenviaba lotes de métricas sin idempotencia y el server
  // los insertaba duplicados: la tabla se infló ~150x. La limpieza del
  // histórico + la creación del índice único metrics_natural_key (que hace que
  // skipDuplicates / ON CONFLICT DO NOTHING rechace los reenvíos) se hacen en
  // cleanMetricsOnce() abajo — una sola vez, en segundo plano.
  // v27 — alertas del sistema (campanita del panel + red de seguridad de bw).
  { name: 'system_alerts', sql: `CREATE TABLE IF NOT EXISTS system_alerts (id BIGSERIAL PRIMARY KEY, type TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'warning', title TEXT NOT NULL, body TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), acknowledged_at TIMESTAMPTZ)` },
  { name: 'system_alerts.idx', sql: `CREATE INDEX IF NOT EXISTS system_alerts_open_idx ON system_alerts(acknowledged_at, id DESC)` },
  { name: 'system_alerts.rls', sql: `ALTER TABLE system_alerts ENABLE ROW LEVEL SECURITY` },
  // v28 — interruptor maestro "producción congelada". Arranca en '1' (congelado)
  // si la clave no existe. Sólo se descongela seteándola en '0' explícitamente.
  { name: 'fleet_frozen.default', sql: `INSERT INTO system_config (key, value) VALUES ('fleet_frozen', '1') ON CONFLICT (key) DO NOTHING` },
  // v29 — peso del archivo de cada anuncio (bytes), para el peso por campaña.
  { name: 'ads.file_size', sql: `ALTER TABLE ads ADD COLUMN IF NOT EXISTS file_size INT` },
  // v30 — reproducciones por anuncio en la lista de Anuncios (GROUP BY ad_id).
  { name: 'metrics.ad_idx', sql: `CREATE INDEX IF NOT EXISTS metrics_ad_id_idx ON metrics(ad_id, played_at)` },
  // v31 — Mantenimiento: órdenes (con checklist, fotos y repuestos usados),
  // inventario de repuestos con sus movimientos, reglas recurrentes y
  // diagnósticos pedidos a la tablet. Sólo tablas nuevas: nada se borra ni se
  // modifica. Si se borra una tablet, sus órdenes quedan (tablet_id → NULL,
  // tablet_name guarda el nombre). Las órdenes no se borran: se cancelan.
  { name: 'maintenance_orders', sql: `CREATE TABLE IF NOT EXISTS maintenance_orders (id SERIAL PRIMARY KEY, tablet_id INT REFERENCES tablets(id) ON DELETE SET NULL, tablet_name TEXT, type TEXT NOT NULL DEFAULT 'revision', title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pendiente', priority TEXT NOT NULL DEFAULT 'normal', scheduled_for TIMESTAMPTZ, assignee TEXT, notes TEXT, resolution TEXT, checklist JSONB NOT NULL DEFAULT '[]', photos JSONB NOT NULL DEFAULT '[]', parts JSONB NOT NULL DEFAULT '[]', parts_applied BOOLEAN NOT NULL DEFAULT false, workshop BOOLEAN NOT NULL DEFAULT false, source TEXT NOT NULL DEFAULT 'manual', alert_code TEXT, rule_id INT, created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ)` },
  { name: 'maintenance_orders.tablet_idx', sql: `CREATE INDEX IF NOT EXISTS maintenance_orders_tablet_idx ON maintenance_orders(tablet_id, status)` },
  { name: 'maintenance_orders.sched_idx', sql: `CREATE INDEX IF NOT EXISTS maintenance_orders_sched_idx ON maintenance_orders(status, scheduled_for)` },
  { name: 'maintenance_orders.rule_idx', sql: `CREATE INDEX IF NOT EXISTS maintenance_orders_rule_idx ON maintenance_orders(rule_id, tablet_id)` },
  { name: 'maintenance_parts', sql: `CREATE TABLE IF NOT EXISTS maintenance_parts (id SERIAL PRIMARY KEY, name TEXT NOT NULL, category TEXT, unit TEXT NOT NULL DEFAULT 'u', stock INT NOT NULL DEFAULT 0, min_stock INT NOT NULL DEFAULT 0, notes TEXT, active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'maintenance_part_moves', sql: `CREATE TABLE IF NOT EXISTS maintenance_part_moves (id SERIAL PRIMARY KEY, part_id INT NOT NULL REFERENCES maintenance_parts(id) ON DELETE CASCADE, delta INT NOT NULL, reason TEXT, order_id INT REFERENCES maintenance_orders(id) ON DELETE SET NULL, created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'maintenance_part_moves.idx', sql: `CREATE INDEX IF NOT EXISTS maintenance_part_moves_part_idx ON maintenance_part_moves(part_id, created_at DESC)` },
  { name: 'maintenance_rules', sql: `CREATE TABLE IF NOT EXISTS maintenance_rules (id SERIAL PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'revision', every_days INT NOT NULL, lead_days INT NOT NULL DEFAULT 3, scope TEXT NOT NULL DEFAULT 'all', scope_id INT, assignee TEXT, notify BOOLEAN NOT NULL DEFAULT true, active BOOLEAN NOT NULL DEFAULT true, starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_run_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'tablet_diagnostics', sql: `CREATE TABLE IF NOT EXISTS tablet_diagnostics (id BIGSERIAL PRIMARY KEY, tablet_id INT NOT NULL REFERENCES tablets(id) ON DELETE CASCADE, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'tablet_diagnostics.idx', sql: `CREATE INDEX IF NOT EXISTS tablet_diagnostics_tablet_idx ON tablet_diagnostics(tablet_id, created_at DESC)` },
  // v-portal — acceso de empresas al portal de estadísticas
  // v-sin-campañas — el anuncio pasa a tener su empresa y un nombre público;
  // las playlists se pueden pausar. El borrado de campañas va en
  // removeCampaignsOnce() (necesita copiar datos antes de borrar).
  { name: 'ads.client_id', sql: `ALTER TABLE ads ADD COLUMN IF NOT EXISTS client_id INT REFERENCES clients(id)` },
  { name: 'ads.public_name', sql: `ALTER TABLE ads ADD COLUMN IF NOT EXISTS public_name TEXT` },
  { name: 'ads.client_idx', sql: `CREATE INDEX IF NOT EXISTS ads_client_id_idx ON ads(client_id)` },
  { name: 'clients.portal_max_ad_seconds', sql: `ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_max_ad_seconds INTEGER` },
  { name: 'ads.uploaded_by_client', sql: `ALTER TABLE ads ADD COLUMN IF NOT EXISTS uploaded_by_client BOOLEAN NOT NULL DEFAULT false` },
  { name: 'playlists.active', sql: `ALTER TABLE playlists ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true` },
  { name: 'client_users', sql: `CREATE TABLE IF NOT EXISTS client_users (id SERIAL PRIMARY KEY, client_id INT NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE, email TEXT NOT NULL UNIQUE, password_hash TEXT, active BOOLEAN NOT NULL DEFAULT true, session_version INT NOT NULL DEFAULT 0, failed_logins INT NOT NULL DEFAULT 0, locked_until TIMESTAMPTZ, invite_token_hash TEXT UNIQUE, invite_expires_at TIMESTAMPTZ, invited_at TIMESTAMPTZ, reset_token_hash TEXT UNIQUE, reset_expires_at TIMESTAMPTZ, last_login_at TIMESTAMPTZ, last_login_ip TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
];

// Garantiza el índice único metrics_natural_key (tablet_id, ad_id, played_at)
// SIN borrar métricas reales. Antes, si el índice faltaba, se VACIABA la tabla
// (pensado como one-shot para la inflación de sept-2026) — y como el
// `db push --accept-data-loss` del build de Render borraba el índice en cada
// deploy, cada deploy vaciaba las métricas. Ahora: si falta, se intenta crear;
// si hay duplicados que lo impiden, se borran SÓLO los duplicados (se queda la
// fila más vieja) y se reintenta.
async function ensureMetricsIndex() {
  const create = () => prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS metrics_natural_key ON metrics (tablet_id, ad_id, played_at)`,
  );
  try {
    const idx = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM pg_indexes WHERE indexname = 'metrics_natural_key' LIMIT 1`,
    );
    if (Array.isArray(idx) && idx.length > 0) return;
    try {
      await create();
      console.log('[migrate] metrics_natural_key — creado');
      return;
    } catch (err) {
      console.warn(`[migrate] metrics_natural_key — no se pudo crear (${err.message}); quitando duplicados`);
    }
    const deduped = Number(await prisma.$executeRawUnsafe(
      `DELETE FROM metrics a USING metrics b
       WHERE a.id > b.id AND a.tablet_id = b.tablet_id
         AND a.ad_id = b.ad_id AND a.played_at = b.played_at`,
    ));
    await create();
    console.log(`[migrate] metrics_natural_key — creado tras quitar ${deduped} duplicados (sin borrar métricas reales)`);
  } catch (err) {
    console.error(`[migrate] metrics_natural_key — FAILED: ${err.message}`);
  }
}

// Bloquea la API auto-generada de Supabase (PostgREST) sobre el esquema
// `public`. Este proyecto NO usa PostgREST ni Supabase Auth — tiene su propia
// auth JWT en el backend, que conecta como `postgres` (BYPASSRLS) por
// DATABASE_URL y NO se ve afectado. El Storage (subida de anuncios con la anon
// key) vive en el esquema `storage`, aparte — sigue funcionando.
// Idempotente y barato: corre en cada arranque, así cualquier tabla nueva
// (o cualquier grant que Supabase reponga) queda cubierta en el próximo deploy.
async function hardenPublicSchema() {
  const stmts = [
    // 1) RLS en TODAS las tablas de public (deny-all: sin policies).
    `DO $$ DECLARE r record; BEGIN
       FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
       LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename); END LOOP;
     END $$`,
    // 2) Sacarle a anon/authenticated TODO acceso a public (lo existente…).
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated`,
    `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated`,
    `REVOKE USAGE ON SCHEMA public FROM anon, authenticated`,
    // …y lo futuro (default privileges de los objetos que cree este rol).
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated`,
  ];
  for (const sql of stmts) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (err) {
      console.error(`[harden] FAILED (${sql.slice(0, 48).replace(/\s+/g, ' ')}…): ${err.message}`);
    }
  }
  try {
    const [rls] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM pg_class c
       JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false`,
    );
    // Lo que importa: ¿anon/authenticated tienen ALGÚN privilegio sobre CUALQUIER
    // tabla de public? (USAGE del esquema solo no da acceso a nada.)
    const [grants] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')`,
    );
    console.log(`[harden] tablas public sin RLS: ${rls?.n} | grants a anon/authenticated sobre tablas public: ${grants?.n}`);
  } catch (err) {
    console.error(`[harden] verificación falló: ${err.message}`);
  }
}

// One-shot: bloquea toda la flota al arrancar (pedido del usuario — quería
// congelarla mientras se despliega la red de seguridad de ancho de banda, y no
// podía hacerlo con la app caída). Se desbloquea desde el panel cuando verifica.
// Guardado por systemConfig: no vuelve a correr en deploys siguientes.
async function autoBlockFleetOnce() {
  try {
    const done = await prisma.systemConfig.findUnique({ where: { key: 'fleet_autoblock_v1' } });
    if (done) return;
    const r = await prisma.tablet.updateMany({
      where: { manualStatus: { not: 'bloqueada' } },
      data: { manualStatus: 'bloqueada' },
    });
    await prisma.systemConfig.upsert({
      where: { key: 'fleet_autoblock_v1' },
      update: { value: new Date().toISOString() },
      create: { key: 'fleet_autoblock_v1', value: new Date().toISOString() },
    });
    console.log(`[migrate] auto-bloqueo de flota: ${r.count} tablets bloqueadas al arrancar — desbloquear desde el panel`);
  } catch (err) {
    console.error(`[migrate] auto-bloqueo FAILED: ${err.message}`);
  }
}

// One-shot (pedido del usuario, 2026-10-30): se eliminan las campañas. Antes
// de borrar, cada anuncio hereda la empresa de su campaña, y sus fechas (el
// día de fin de campaña era inclusivo: termina al final de ese día). Los
// anuncios de campañas pausadas o archivadas quedan pausados. Las métricas se
// ponen en cero y todas las playlists quedan pausadas para probar desde cero.
// Todo en una transacción; guardado por systemConfig para no repetirse.
async function removeCampaignsOnce() {
  const KEY = 'campaigns_removed_v1';
  try {
    const done = await prisma.systemConfig.findUnique({ where: { key: KEY } });
    if (done) return;
    const [{ exists }] = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.campaigns') IS NOT NULL AS exists`);
    const stmts = [];
    if (exists) {
      stmts.push(
        `UPDATE ads a SET client_id = c.client_id FROM campaigns c WHERE a.campaign_id = c.id AND a.client_id IS NULL`,
        `UPDATE ads a SET starts_at = COALESCE(a.starts_at, c.start_date), ends_at = COALESCE(a.ends_at, c.end_date + INTERVAL '1 day') FROM campaigns c WHERE a.campaign_id = c.id`,
        `UPDATE ads a SET active = false FROM campaigns c WHERE a.campaign_id = c.id AND (c.active = false OR c.deleted_at IS NOT NULL)`,
      );
    }
    stmts.push(
      `TRUNCATE metrics`,
      `ALTER TABLE metrics DROP COLUMN IF EXISTS campaign_id`,
      `ALTER TABLE ads DROP COLUMN IF EXISTS campaign_id`,
      `DROP TABLE IF EXISTS comments`,
      `DROP TABLE IF EXISTS campaign_clients`,
      `DROP TABLE IF EXISTS campaign_templates`,
      `DROP TABLE IF EXISTS campaigns`,
      `UPDATE playlists SET active = false, version = version + 1, content_hash = NULL`,
      `DELETE FROM system_config WHERE key = 'campaign_schedule_checked_at'`,
    );
    await prisma.$transaction(stmts.map((sql) => prisma.$executeRawUnsafe(sql)));
    await prisma.systemConfig.create({ data: { key: KEY, value: new Date().toISOString() } });
    console.log('[migrate] campañas eliminadas, métricas en cero y playlists pausadas');
  } catch (err) {
    console.error(`[migrate] removeCampaignsOnce FAILED: ${err.message}`);
  }
}

// One-shot: las tablets subieron, después del reinicio, reproducciones que
// tenían en cola de ANTES (la app guarda y reenvía). Se borran las que son
// anteriores al instante del reinicio; desde ahora /api/device/metrics ya no
// las acepta.
async function purgePreResetMetricsOnce() {
  const KEY = 'metrics_pre_reset_purged_v1';
  try {
    const [done, reset] = await Promise.all([
      prisma.systemConfig.findUnique({ where: { key: KEY } }),
      prisma.systemConfig.findUnique({ where: { key: 'campaigns_removed_v1' } }),
    ]);
    if (done || !reset) return;
    const cutoff = new Date(reset.value);
    if (Number.isNaN(cutoff.getTime())) return;
    const n = await prisma.$executeRaw`DELETE FROM metrics WHERE played_at < ${cutoff}`;
    await prisma.systemConfig.create({ data: { key: KEY, value: new Date().toISOString() } });
    console.log(`[migrate] ${n} métricas anteriores al reinicio borradas`);
  } catch (err) {
    console.error(`[migrate] purgePreResetMetricsOnce FAILED: ${err.message}`);
  }
}

async function runStartupMigrations() {
  for (const m of MIGRATIONS) {
    try {
      await prisma.$executeRawUnsafe(m.sql);
      console.log(`[migrate] ${m.name} — OK`);
    } catch (err) {
      console.error(`[migrate] ${m.name} — FAILED: ${err.message}`);
    }
  }
  await removeCampaignsOnce();
  await purgePreResetMetricsOnce();
  await hardenPublicSchema();
  await autoBlockFleetOnce();
  // En segundo plano para no demorar el arranque (Render marca el deploy como
  // fallido si tarda mucho en abrir el puerto).
  ensureMetricsIndex().catch((e) => console.error('[migrate] ensureMetricsIndex:', e.message));
}

module.exports = runStartupMigrations;
