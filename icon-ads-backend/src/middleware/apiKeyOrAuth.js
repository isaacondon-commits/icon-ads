const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

// Autentica con el JWT del panel (cookie o Bearer) O con una API key activa
// (header X-API-Key) de la tabla api_keys. Se usa en los endpoints de APK para
// poder publicar / forzar la actualización desde un script, sin sesión de
// navegador. El resto del panel sigue siendo sólo-JWT.
async function apiKeyOrAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
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
