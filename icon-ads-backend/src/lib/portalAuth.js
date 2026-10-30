// Seguridad del portal de empresas (estadísticas de solo lectura).
//
// - Sesión propia: JWT con audiencia 'portal' firmado con una clave DISTINTA a
//   la del panel (PORTAL_JWT_SECRET, o derivada de JWT_SECRET). El panel la
//   rechaza siempre (ver middleware/auth.js) y el portal rechaza las del panel.
// - La sesión lleva sessionVersion: subirla en la DB corta todas las sesiones
//   abiertas de esa empresa al instante (desactivar, cambiar contraseña).
// - Al portal sólo se entra a través del proxy del panel en Vercel, que firma
//   cada pedido con PORTAL_PROXY_SECRET. Así la cookie es del mismo dominio
//   del panel (funciona en iPhone) y la IP real del visitante es confiable
//   para limitar intentos.
// - Contraseñas con bcrypt; tokens de invitación/reset sólo como hash SHA-256.

const crypto = require('crypto');
const net = require('net');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('./prisma');

const PORTAL_AUDIENCE = 'portal';
const SESSION_COOKIE = 'portal_session';
const COOKIE_PATH = '/portal-api';
const SESSION_TTL_S = 7 * 24 * 60 * 60;
const INVITE_TTL_MS = 48 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const BCRYPT_ROUNDS = 12;

function sessionSecret() {
  if (process.env.PORTAL_JWT_SECRET) return process.env.PORTAL_JWT_SECRET;
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET no configurado');
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update('iconads-portal-session-v1').digest('hex');
}

function signSession(clientUser) {
  return jwt.sign(
    { cu: clientUser.id, c: clientUser.clientId, v: clientUser.sessionVersion },
    sessionSecret(),
    { expiresIn: SESSION_TTL_S, audience: PORTAL_AUDIENCE, algorithm: 'HS256' }
  );
}

function verifySession(token) {
  try {
    const p = jwt.verify(token, sessionSecret(), { audience: PORTAL_AUDIENCE, algorithms: ['HS256'] });
    if (!Number.isInteger(p.cu) || !Number.isInteger(p.c) || !Number.isInteger(p.v)) return null;
    return p;
  } catch {
    return null;
  }
}

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: COOKIE_PATH,
    maxAge: SESSION_TTL_S * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: COOKIE_PATH,
  });
}

// ── Tokens de un solo uso (invitación / reset) ─────────────────────────────
function newOneTimeToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// ── Contraseñas ─────────────────────────────────────────────────────────────
const COMMON = new Set([
  '1234567890', '0123456789', '12345678910', '1111111111', '0000000000', 'qwertyuiop', 'asdfghjkl1',
  'password12', 'password123', 'contraseña', 'contrasena', 'contraseña1', 'contrasena1', 'contraseña123',
  'contrasena123', 'iloveyou12', 'abcdefghij', 'abc1234567', 'qwerty1234', '1q2w3e4r5t', 'administrador',
  'montevideo', 'montevideo1', 'uruguay123', 'uruguay2026', 'peñarol123', 'nacional123', 'bienvenido',
  'bienvenido1', 'empresa123', 'publicidad', 'publicidad1', 'estadisticas',
]);

/** Devuelve un mensaje de error en español, o null si la contraseña sirve. */
function passwordProblem(password, email = '') {
  if (typeof password !== 'string') return 'Contraseña inválida.';
  if (password.length < 10) return 'La contraseña tiene que tener al menos 10 caracteres.';
  if (password.length > 128) return 'La contraseña es demasiado larga (máximo 128 caracteres).';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'Esa contraseña es demasiado común. Elegí otra.';
  if (/icon\s*ads|iconads/.test(lower)) return 'La contraseña no puede contener "iconads".';
  if (/^(.)\1+$/.test(password)) return 'La contraseña no puede ser un solo carácter repetido.';
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && lower.includes(local)) return 'La contraseña no puede contener tu email.';
  if (new Set(password).size < 5) return 'La contraseña es demasiado simple. Usá más caracteres distintos.';
  return null;
}

const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);

// Hash de relleno: se compara contra él cuando el email no existe, para que la
// respuesta tarde lo mismo y no se pueda averiguar qué emails tienen cuenta.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-never-valid', BCRYPT_ROUNDS);
async function checkPassword(password, hash) {
  const ok = await bcrypt.compare(String(password ?? ''), hash || DUMMY_HASH);
  return ok && !!hash;
}

// Demora creciente por cuenta: desde el 5º intento fallido seguido, la cuenta
// no acepta contraseñas por 1, 2, 4… minutos (tope 60). Nunca 24 h: si no,
// cualquiera que sepa el email de una empresa le bloquea el acceso a propósito.
function lockoutFor(failedLogins) {
  if (failedLogins < 5) return null;
  const minutes = Math.min(60, 2 ** (failedLogins - 5));
  return new Date(Date.now() + minutes * 60 * 1000);
}

// ── Proxy confiable ──────────────────────────────────────────────────────────
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb) && a.length === b.length;
}

// Sólo se aceptan pedidos que vienen del proxy del panel. Sin secreto
// configurado el portal queda apagado (falla cerrado).
function requirePortalProxy(req, res, next) {
  const secret = process.env.PORTAL_PROXY_SECRET;
  if (!secret || secret.length < 32) return res.status(503).json({ error: 'El portal no está disponible.' });
  if (!safeEqual(req.headers['x-portal-proxy-secret'], secret)) return res.status(403).json({ error: 'Forbidden' });
  const ip = String(req.headers['x-portal-client-ip'] || '').trim();
  req.portalIp = net.isIP(ip) ? ip : 'unknown';
  next();
}

// Sesión válida + cuenta y empresa activas + versión de sesión vigente.
async function requirePortalSession(req, res, next) {
  const payload = verifySession(req.cookies?.[SESSION_COOKIE]);
  if (!payload) return res.status(401).json({ error: 'Sesión vencida. Ingresá de nuevo.' });
  try {
    const cu = await prisma.clientUser.findUnique({
      where: { id: payload.cu },
      include: { client: { select: { id: true, name: true, active: true, deletedAt: true } } },
    });
    if (!cu || !cu.active || !cu.passwordHash || cu.clientId !== payload.c || cu.sessionVersion !== payload.v
      || !cu.client || !cu.client.active || cu.client.deletedAt) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Sesión vencida. Ingresá de nuevo.' });
    }
    req.portal = { clientUserId: cu.id, clientId: cu.clientId, clientName: cu.client.name, email: cu.email, sessionVersion: cu.sessionVersion };
    next();
  } catch (err) {
    next(err);
  }
}

// ── Permiso de subida ───────────────────────────────────────────────────────
// El archivo de un anuncio no entra por el proxy de Vercel (corta los pedidos
// de más de ~4,5 MB). El portal pide por el proxy un permiso firmado, corto y
// de un solo uso, y con él el navegador manda el archivo directo al backend
// (POST /api/portal-upload). El permiso lleva la sesión: si la empresa cambia
// la contraseña o la desactivan, deja de servir.
const UPLOAD_AUDIENCE = 'portal-upload';
const UPLOAD_TTL_S = 15 * 60;
const usedUploadTickets = new Map(); // jti -> vence (ms)

function signUploadTicket(portal) {
  return jwt.sign(
    { cu: portal.clientUserId, c: portal.clientId, v: portal.sessionVersion, jti: crypto.randomBytes(16).toString('hex') },
    sessionSecret(),
    { expiresIn: UPLOAD_TTL_S, audience: UPLOAD_AUDIENCE, algorithm: 'HS256' }
  );
}

// Valida el permiso (firma, vencimiento, un solo uso) y que la cuenta y la
// empresa sigan activas con la misma sesión. Deja req.portal como la sesión.
async function requireUploadTicket(req, res, next) {
  const auth = String(req.headers.authorization || '');
  let p;
  try {
    p = jwt.verify(auth.replace(/^Bearer\s+/i, ''), sessionSecret(), { audience: UPLOAD_AUDIENCE, algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'El permiso para subir venció. Probá de nuevo.' });
  }
  const now = Date.now();
  for (const [k, exp] of usedUploadTickets) if (exp < now) usedUploadTickets.delete(k);
  if (typeof p.jti !== 'string' || usedUploadTickets.has(p.jti)) {
    return res.status(401).json({ error: 'Ese permiso ya se usó. Probá de nuevo.' });
  }
  usedUploadTickets.set(p.jti, p.exp * 1000);
  try {
    const cu = await prisma.clientUser.findUnique({
      where: { id: p.cu },
      include: { client: { select: { id: true, name: true, active: true, deletedAt: true } } },
    });
    if (!cu || !cu.active || !cu.passwordHash || cu.clientId !== p.c || cu.sessionVersion !== p.v
      || !cu.client || !cu.client.active || cu.client.deletedAt) {
      return res.status(401).json({ error: 'Sesión vencida. Ingresá de nuevo.' });
    }
    req.portal = { clientUserId: cu.id, clientId: cu.clientId, clientName: cu.client.name, email: cu.email, sessionVersion: cu.sessionVersion };
    next();
  } catch (err) {
    next(err);
  }
}

async function logPortalEvent(action, clientUserId, details, ip) {
  try {
    await prisma.auditLog.create({
      data: { userId: null, action, entity: 'client_user', entityId: clientUserId ?? null, details: details ?? null, ip: ip ?? null },
    });
  } catch { /* no rompe el pedido */ }
}

module.exports = {
  SESSION_COOKIE, COOKIE_PATH, INVITE_TTL_MS, RESET_TTL_MS,
  signSession, verifySession, setSessionCookie, clearSessionCookie,
  newOneTimeToken, hashToken, passwordProblem, hashPassword, checkPassword, lockoutFor,
  requirePortalProxy, requirePortalSession, logPortalEvent,
  signUploadTicket, requireUploadTicket,
};
