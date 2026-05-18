const prisma = require('./prisma');
const syslog = require('./systemLog');

async function audit(req, action, entity, entityId, details) {
  const userId = req.user?.id ?? null;
  const ip = req.ip || req.headers['x-forwarded-for'] || null;
  syslog.addEvent(action, entity, entityId, details, userId, ip);
  try {
    await prisma.auditLog.create({ data: { userId, action, entity, entityId: entityId ?? null, details: details ?? null, ip } });
  } catch {
    // non-fatal: don't let audit failures break requests
  }
}

module.exports = { audit };
