/**
 * Startup migration: adds columns that prisma db push can't apply when DIRECT_URL
 * is missing (PgBouncer transaction-mode pooler doesn't support full schema migrations).
 * ALTER TABLE ... ADD COLUMN IF NOT EXISTS is DDL-safe through PgBouncer.
 */
const prisma = require('./prisma');

const MIGRATIONS = [
  // Original missing columns (DIRECT_URL not set on Render)
  { name: 'campaigns.cpm',              sql: `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS cpm FLOAT` },
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
  { name: 'campaigns.max_impressions',  sql: `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS max_impressions INT` },
  { name: 'system_config',              sql: `CREATE TABLE IF NOT EXISTS system_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  // v5 — new fields: campaign observations + budget, client commercial contact, tablet last_ip
  { name: 'campaigns.observations',    sql: `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS observations TEXT` },
  { name: 'campaigns.budget',          sql: `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS budget FLOAT` },
  { name: 'clients.contact_name',      sql: `ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_name TEXT` },
  { name: 'clients.contact_phone',     sql: `ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_phone TEXT` },
  { name: 'tablets.last_ip',           sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS last_ip TEXT` },
  // v6 — tablet OS/model indicator (#2), campaign goals (#33)
  { name: 'tablets.os_version',        sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS os_version TEXT` },
  { name: 'tablets.device_model',      sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS device_model TEXT` },
  { name: 'campaigns.target_impressions', sql: `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS target_impressions INT` },
  // v7 — ad tags (#16)
  { name: 'ads.tags',                  sql: `ALTER TABLE ads ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'` },
  // v8 — shared admin notes (#36)
  { name: 'admin_notes',               sql: `CREATE TABLE IF NOT EXISTS admin_notes (id SERIAL PRIMARY KEY, body TEXT NOT NULL, author_name TEXT NOT NULL DEFAULT 'Admin', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  // v9 — campaign templates (#31) + favorites (#44)
  { name: 'campaign_templates',        sql: `CREATE TABLE IF NOT EXISTS campaign_templates (id SERIAL PRIMARY KEY, name TEXT NOT NULL, cpm FLOAT, max_impressions INT, budget FLOAT, target_impressions INT, observations TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
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
  { name: 'campaign_clients',          sql: `CREATE TABLE IF NOT EXISTS campaign_clients (id SERIAL PRIMARY KEY, campaign_id INT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(campaign_id, client_id))` },
  { name: 'campaign_clients.idx',      sql: `CREATE INDEX IF NOT EXISTS campaign_clients_client_idx ON campaign_clients(client_id)` },
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
];

// One-shot: vacía metrics si todavía no tiene el índice único. Data de prueba,
// inflada ~150x por reenvíos duplicados y sin forma barata de separar real de
// duplicado en las horas pico. El candado es el propio índice: una vez creado
// (sobre la tabla ya vacía), esto no vuelve a tocar nada en deploys futuros.
// NO afecta playlists, anuncios, campañas ni tablets — sólo el log de plays.
//
// Se borra por tandas (DELETE ... LIMIT) en vez de TRUNCATE: las 12 tablets
// insertan cada 10 s y TRUNCATE necesita un ACCESS EXCLUSIVE lock que no llega
// a conseguir -> se abortaba y el índice nunca se creaba. El DELETE por lotes
// toma locks de fila, no choca con los INSERT, y cada lote es rápido.
async function cleanMetricsOnce() {
  try {
    const idx = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM pg_indexes WHERE indexname = 'metrics_natural_key' LIMIT 1`,
    );
    if (Array.isArray(idx) && idx.length > 0) return; // ya limpio + indexado

    // 1) Achicar el grueso por tandas. Corta cuando lo que queda es chico
    //    (sólo filas reales recientes + algún duplicado nuevo suelto).
    let total = 0;
    for (let i = 0; i < 5000; i++) {
      const n = Number(await prisma.$executeRawUnsafe(
        `DELETE FROM metrics WHERE id IN (SELECT id FROM metrics LIMIT 50000)`,
      ));
      total += n;
      if (n < 5000) break;
    }
    // 2) Dedup puntual sobre el remanente (ya es una tabla chica).
    const deduped = Number(await prisma.$executeRawUnsafe(
      `DELETE FROM metrics a USING metrics b
       WHERE a.id > b.id AND a.tablet_id = b.tablet_id
         AND a.ad_id = b.ad_id AND a.played_at = b.played_at`,
    ));
    console.log(`[migrate] metrics — limpieza one-shot: ${total} borradas por tanda + ${deduped} duplicados del remanente`);

    // 3) El candado: con la tabla ya sin duplicados, crear el índice único.
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS metrics_natural_key ON metrics (tablet_id, ad_id, played_at)`,
    );
    console.log('[migrate] metrics_natural_key — creado tras la limpieza');
  } catch (err) {
    console.error(`[migrate] metrics limpieza one-shot — FAILED: ${err.message}`);
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

async function runStartupMigrations() {
  for (const m of MIGRATIONS) {
    try {
      await prisma.$executeRawUnsafe(m.sql);
      console.log(`[migrate] ${m.name} — OK`);
    } catch (err) {
      console.error(`[migrate] ${m.name} — FAILED: ${err.message}`);
    }
  }
  await hardenPublicSchema();
  await autoBlockFleetOnce();
  // Limpieza pesada del histórico de metrics: en segundo plano para no
  // demorar el arranque del server (Render marca el deploy como fallido si
  // tarda mucho en abrir el puerto). Se reintenta en cada deploy hasta que
  // exista el índice único.
  cleanMetricsOnce().catch((e) => console.error('[migrate] cleanMetricsOnce:', e.message));
}

module.exports = runStartupMigrations;
