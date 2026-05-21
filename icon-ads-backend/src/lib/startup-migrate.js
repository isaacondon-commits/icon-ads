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
