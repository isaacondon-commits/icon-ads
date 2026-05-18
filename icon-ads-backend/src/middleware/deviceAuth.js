const prisma = require('../lib/prisma');

async function requireDevice(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  const token = auth.slice(7);
  try {
    const tablet = await prisma.tablet.findUnique({ where: { token } });
    if (!tablet) {
      // #56 — log unauthorized device attempts
      console.warn(`[SECURITY] Invalid device token attempt — IP: ${req.ip} token_prefix: ${token.slice(0, 8)}...`);
      return res.status(401).json({ error: 'Invalid device token' });
    }
    req.tablet = tablet;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireDevice };
