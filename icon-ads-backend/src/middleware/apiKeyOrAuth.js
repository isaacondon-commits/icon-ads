const { verifyPanelToken } = require('./auth');
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
// Con JWT, los GET quedan abiertos a cualquier rol (operator lee), pero toda
// escritura (bloquear flota, congelar, borrar tablets, publicar APK…) exige
// admin/superadmin. `apiKeyOrAuth.anyRole` es la variante sin ese chequeo,
// para acciones inocuas (p. ej. marcar una alerta como leída).
const ADMIN_ROLES = ['admin', 'superadmin'];

function apiKeyOrAuth(req, res, next) {
  return authenticate(req, res, next, { adminForWrites: true });
}
apiKeyOrAuth.anyRole = (req, res, next) => authenticate(req, res, next, { adminForWrites: false });

async function authenticate(req, res, next, { adminForWrites }) {
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
  const payload = verifyPanelToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
  req.user = payload;
  if (adminForWrites && req.method !== 'GET' && !ADMIN_ROLES.includes(req.user?.role)) {
    return res.status(403).json({ error: 'Acceso denegado: se requiere rol de administrador' });
  }
  next();
}

module.exports = apiKeyOrAuth;
