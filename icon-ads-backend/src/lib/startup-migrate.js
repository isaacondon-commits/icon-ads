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
  // v23 — multiple clients per campaign (billing client stays campaigns.client_id;
  // this table holds additional clients associated with the campaign)
  { name: 'campaign_clients',          sql: `CREATE TABLE IF NOT EXISTS campaign_clients (id SERIAL PRIMARY KEY, campaign_id INT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(campaign_id, client_id))` },
  { name: 'campaign_clients.idx',      sql: `CREATE INDEX IF NOT EXISTS campaign_clients_client_idx ON campaign_clients(client_id)` },
];

async function runStartupMigrations() {
  for (const m of MIGRATIONS) {
    try {
      await prisma.$executeRawUnsafe(m.sql);
      console.log(`[migrate] ${m.name} — OK`);
    } catch (err) {
      console.error(`[migrate] ${m.name} — FAILED: ${err.message}`);
    }
  }
}

module.exports = runStartupMigrations;
