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
