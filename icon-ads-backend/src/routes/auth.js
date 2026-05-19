const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../lib/auditLog');

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// 5 login attempts per hour per IP (#31)
const loginLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Demasiados intentos fallidos. Intentá de nuevo en 1 hora.' },
});

router.post('/login', loginLimiter, async (req, res, next) => {
  const ip = req.ip;
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });

    if (user?.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const minutesLeft = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 60000);
      return res.status(423).json({ error: `Cuenta bloqueada. Intentá de nuevo en ${minutesLeft} minuto${minutesLeft !== 1 ? 's' : ''}.` });
    }

    if (!user || !(await bcrypt.compare(password, user.password))) {
      console.warn(`[auth] Login fallido — email=${email} ip=${ip}`);
      await prisma.auditLog.create({
        data: { action: 'LOGIN_FAILED', entity: 'user', details: `email=${email}`, ip },
      }).catch(() => {});
      if (user) {
        const newFailed = (user.failedLogins ?? 0) + 1;
        const lockUntil = newFailed >= 5 ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null;
        await prisma.user.update({
          where: { id: user.id },
          data: { failedLogins: newFailed, ...(lockUntil ? { lockedUntil: lockUntil } : {}) },
        }).catch(() => {});
        if (newFailed >= 5) {
          return res.status(423).json({ error: 'Cuenta bloqueada por múltiples intentos fallidos. Contactá al administrador.' });
        }
        return res.status(401).json({ error: `Credenciales inválidas. Intentos restantes: ${5 - newFailed}` });
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if ((user.failedLogins ?? 0) > 0) {
      await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } }).catch(() => {});
    }

    const expiresIn = process.env.JWT_EXPIRES_IN || '8h'; // #34 — 8h default
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn }
    );

    const maxAgeMs = expiresIn === '8h' ? 8 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: maxAgeMs,
    });

    // #35 — Log successful login
    await audit({ user, ip }, 'LOGIN', 'user', user.id, `Login exitoso desde ${ip}`);

    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  await audit(req, 'LOGOUT', 'user', req.user.id, 'Logout').catch(() => {});
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  });
  res.json({ message: 'Logged out' });
});

router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8, 'Mínimo 8 caracteres'),
    }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(400).json({ error: 'Contraseña actual incorrecta' });
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: req.user.id }, data: { password: hashed } });
    await audit(req, 'CHANGE_PASSWORD', 'user', req.user.id, 'Cambio de contraseña');
    res.json({ ok: true });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors[0]?.message ?? err.errors });
    next(err);
  }
});

router.patch('/unlock/:userId', requireAuth, async (req, res, next) => {
  if (req.user?.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const user = await prisma.user.update({
      where: { id: Number(req.params.userId) },
      data: { failedLogins: 0, lockedUntil: null },
      select: { id: true, email: true, name: true },
    });
    await audit(req, 'UNLOCK_ACCOUNT', 'user', user.id, `Desbloqueó cuenta de ${user.email}`);
    res.json({ ok: true, user });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'User not found' });
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, name: true, role: true },
    });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
