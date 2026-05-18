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
const logsRoutes = require('./routes/logs');
const prisma = require('./lib/prisma');
const { sendTabletOfflineAlert } = require('./lib/mailer');
const syslog = require('./lib/systemLog');

const app = express();

app.use(compression());

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

app.get('/api/health', async (req, res) => {
  let dbStatus = 'ok';
  try { await prisma.$queryRaw`SELECT 1`; } catch { dbStatus = 'error'; }
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
app.use('/api/logs', logsRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// #7 — Offline tablet alert check every 30 minutes
const alertedTablets = new Set();
setInterval(async () => {
  try {
    const tablets = await prisma.tablet.findMany({ select: { id: true, name: true, deviceId: true, zone: true, lastSync: true } });
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    for (const t of tablets) {
      const lastSyncMs = t.lastSync ? new Date(t.lastSync).getTime() : 0;
      const isOffline = lastSyncMs < twoHoursAgo;
      if (isOffline && !alertedTablets.has(t.id)) {
        alertedTablets.add(t.id);
        syslog.addEvent('TABLET_OFFLINE', 'tablet', t.id, `${t.name} offline >2h`);
        await sendTabletOfflineAlert(t);
      } else if (!isOffline && alertedTablets.has(t.id)) {
        alertedTablets.delete(t.id);
        syslog.addEvent('TABLET_BACK_ONLINE', 'tablet', t.id, `${t.name} came back online`);
      }
    }
  } catch (err) {
    console.warn('[offline-check]', err.message);
  }
}, 30 * 60 * 1000);

module.exports = app;
