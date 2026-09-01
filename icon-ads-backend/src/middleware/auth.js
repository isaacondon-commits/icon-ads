const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Acceso de administración pleno: admin / superadmin.
// Bloquea 'operator' (solo lectura) y 'supervisor' (sólo puede CREAR anuncios,
// campañas y playlists — ver requireCreator).
function requireAdmin(req, res, next) {
  if (!['admin', 'superadmin'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Acceso denegado: se requiere rol de administrador' });
  }
  next();
}

// Permite CREAR contenido (anuncios, campañas, playlists): admin / superadmin /
// supervisor. Sigue bloqueando 'operator'. Editar y borrar ese contenido queda
// en requireAdmin.
function requireCreator(req, res, next) {
  if (!['admin', 'superadmin', 'supervisor'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Acceso denegado: cuenta de solo lectura' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireCreator };
