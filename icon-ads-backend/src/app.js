const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');

const authRoutes = require('./routes/auth');
const clientRoutes = require('./routes/clients');
const campaignRoutes = require('./routes/campaigns');
const adRoutes = require('./routes/ads');
const playlistRoutes = require('./routes/playlists');
const tabletRoutes = require('./routes/tablets');
const deviceRoutes = require('./routes/device');
const statsRoutes = require('./routes/stats');
const prisma = require('./lib/prisma');

const app = express();

// #52 — gzip all responses
app.use(compression());

// #51 — 60 req/min per IP on API routes (devices get a tighter limit via their own middleware)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again in a minute.' },
});
app.use('/api', apiLimiter);

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3001',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// #55 — health endpoint (no auth required)
app.get('/api/health', async (req, res) => {
  let dbStatus = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = 'error';
  }
  res.json({
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    db: dbStatus,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '1.0.0',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/ads', adRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/tablets', tabletRoutes);
app.use('/api/device', deviceRoutes);
app.use('/api/stats', statsRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
