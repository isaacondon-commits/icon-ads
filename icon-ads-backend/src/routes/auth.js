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

    if (!user || !(await bcrypt.compare(password, user.password))) {
      // #35 — Log failed login attempt
      console.warn(`[auth] Login fallido — email=${email} ip=${ip}`);
      await prisma.auditLog.create({
        data: { action: 'LOGIN_FAILED', entity: 'user', details: `email=${email}`, ip },
      }).catch(() => {});
      return res.status(401).json({ error: 'Invalid credentials' });
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
