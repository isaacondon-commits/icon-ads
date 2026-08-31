const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../lib/prisma');

// Compara en tiempo constante (evita distinguir por timing).
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Autentica con el JWT del panel (cookie o Bearer) O con una API key por header
// X-API-Key. La key puede ser:
//   - process.env.PUBLISH_API_KEY  (una sola, para el script de publicación —
//     se setea en el dashboard de Render, no necesita tocar la DB ni el panel)
//   - una fila activa de la tabla api_keys (generada desde /api-control)
// Se usa sólo en los endpoints de APK; el resto del panel sigue siendo sólo-JWT.
async function apiKeyOrAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    if (process.env.PUBLISH_API_KEY && safeEqual(apiKey, process.env.PUBLISH_API_KEY)) {
      req.apiKeyAuth = 'publish-env';
      return next();
    }
    try {
      const row = await prisma.apiKey.findUnique({ where: { key: apiKey } });
      if (!row || !row.active) return res.status(403).json({ error: 'API key inválida o revocada' });
      prisma.apiKey.update({ where: { id: row.id }, data: { lastUsed: new Date() } }).catch(() => {});
      req.apiKeyAuth = row.name;
      return next();
    } catch (err) {
      return next(err);
    }
  }

  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = apiKeyOrAuth;
