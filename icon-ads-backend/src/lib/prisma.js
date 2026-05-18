const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: [{ level: 'error', emit: 'stdout' }, { level: 'warn', emit: 'stdout' }],
});

module.exports = prisma;
