/**
 * Startup migration: adds columns that prisma db push can't apply when DIRECT_URL
 * is missing (PgBouncer transaction-mode pooler doesn't support full schema migrations).
 * ALTER TABLE ... ADD COLUMN IF NOT EXISTS is DDL-safe through PgBouncer.
 */
const prisma = require('./prisma');

const MIGRATIONS = [
  {
    name: 'campaigns.cpm',
    sql: `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS cpm FLOAT`,
  },
  {
    name: 'tablets.notes',
    sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS notes TEXT`,
  },
  {
    name: 'tablets.maintenance_until',
    sql: `ALTER TABLE tablets ADD COLUMN IF NOT EXISTS maintenance_until TIMESTAMPTZ`,
  },
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
