const jwt = require('jsonwebtoken');

// Sesiones del panel de administración. Toda sesión del panel se firma con
// aud='panel' y un rol de esta lista; cualquier otro token firmado con
// JWT_SECRET (p. ej. un futuro portal de clientes) se rechaza acá, aunque la
// firma sea válida. Así una cuenta que no es del panel nunca puede leer rutas
// del panel, ni siquiera las que sólo piden "estar logueado".
const PANEL_AUDIENCE = 'panel';
const PANEL_ROLES = ['superadmin', 'admin', 'supervisor', 'operator'];

function signPanelToken(user, expiresIn) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn, audience: PANEL_AUDIENCE, algorithm: 'HS256' }
  );
}

/** Devuelve el payload si es una sesión válida del panel, o null. */
function verifyPanelToken(token) {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      audience: PANEL_AUDIENCE,
      algorithms: ['HS256'],
    });
    if (!Number.isInteger(payload.id) || !PANEL_ROLES.includes(payload.role)) return null;
    return payload;
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const payload = verifyPanelToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
  req.user = payload;
  next();
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

module.exports = { requireAuth, requireAdmin, requireCreator, signPanelToken, verifyPanelToken, PANEL_ROLES };
