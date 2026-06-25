const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const morgan = require('morgan');
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
const adminRoutes = require('./routes/admin');
const notificationRoutes = require('./routes/notifications');
const settingsRoutes = require('./routes/settings');
const dashboardRoutes = require('./routes/dashboard');
const notesRoutes = require('./routes/notes');
const templatesRoutes = require('./routes/templates');
const favoritesRoutes = require('./routes/favorites');
const remindersRoutes = require('./routes/reminders');
const abtestsRoutes = require('./routes/abtests');
const referralsRoutes = require('./routes/referrals');
const driverpointsRoutes = require('./routes/driverpoints');
const zonesRoutes = require('./routes/zones');
const publicRoutes = require('./routes/public');
const surveysRoutes = require('./routes/surveys');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const latencyTracker = require('./lib/latencyTracker');
const prisma = require('./lib/prisma');
const r2 = require('./lib/r2');
const supabaseStorage = require('./lib/supabase-storage');
const { sendTabletOfflineAlert } = require('./lib/mailer');
const syslog = require('./lib/systemLog');

const app = express();

// Trust Render's/Vercel's reverse proxy so rate limiting and IP logging use real client IPs
app.set('trust proxy', 1);

// ── Maintenance mode (#11) ───────────────────────────────────────────────────
let maintenanceMode = false;
async function refreshMaintenanceMode() {
  try {
    const cfg = await prisma.systemConfig.findUnique({ where: { key: 'maintenance_mode' } });
    maintenanceMode = cfg?.value === 'true';
  } catch { /* DB may not be ready yet */ }
}
setInterval(refreshMaintenanceMode, 60_000);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
  skip: (req) => req.path === '/api/health',
}));
app.use(compression());

// Endpoint latency tracker (#43)
app.use((req, res, next) => {
  if (req.path === '/api/health') return next();
  const start = Date.now();
  res.on('finish', () => latencyTracker.record(req.method, req.path, Date.now() - start, res.statusCode));
  next();
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again in a minute.' },
});
app.use('/api', apiLimiter);

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3001')
  .split(',').map((s) => s.trim());

app.use(cors({
  origin: (origin, cb) => {
    // Allow server-side requests (no Origin header) and any localhost port in dev
    if (!origin || origin.startsWith('http://localhost:') || allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    cb(new Error(`CORS: origin not allowed — ${origin}`));
  },
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Maintenance mode gate (skip health, auth, device)
app.use((req, res, next) => {
  if (!maintenanceMode) return next();
  if (req.path === '/api/health' || req.path.startsWith('/api/auth') || req.path.startsWith('/api/device')) return next();
  res.status(503).json({ error: 'Sistema en mantenimiento. Intentá de nuevo más tarde.' });
});

app.get('/api/health', async (req, res) => {
  let dbStatus = 'ok';
  let dbError = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    dbStatus = 'error';
    dbError = err.message;
    console.error('[health] DB connection error:', err);
  }
  res.json({
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    db: dbStatus,
    dbError,
    r2: r2.isConfigured,
    supabase_storage: supabaseStorage.isConfigured,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '1.0.0',
    env: {
      NODE_ENV: process.env.NODE_ENV ?? 'unset',
      FRONTEND_URL: process.env.FRONTEND_URL ? 'set' : 'UNSET — CORS will block Vercel',
      JWT_SECRET: process.env.JWT_SECRET ? 'set' : 'UNSET — auth will fail',
      DATABASE_URL: process.env.DATABASE_URL ? 'set' : 'UNSET — DB unavailable',
      DIRECT_URL: process.env.DIRECT_URL ? 'set' : 'unset (schema migrations may fail)',
      SUPABASE_URL: process.env.SUPABASE_URL ? 'set' : 'unset (storage uses local disk)',
      SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY ? 'set' : 'unset (storage uses local disk)',
    },
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
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/favorites', favoritesRoutes);
app.use('/api/reminders', remindersRoutes);
app.use('/api/abtests', abtestsRoutes);
app.use('/api/referrals', referralsRoutes);
app.use('/api/driver-points', driverpointsRoutes);
app.use('/api/zones', zonesRoutes);
app.use('/api/surveys', surveysRoutes);
app.use('/api/v1/public', publicRoutes);

// #41 — Swagger API docs at /api/docs
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ICON ADS API',
      version: '1.0.0',
      description: 'API para gestión de publicidad digital en tablets de taxi',
      contact: { name: 'ICON ADS', email: 'admin@iconads.com' },
    },
    servers: [{ url: process.env.BACKEND_URL || 'https://icon-ads-backend.onrender.com', description: 'Producción' }, { url: 'http://localhost:3000', description: 'Desarrollo' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'token' },
        apiKeyHeader: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
    },
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    tags: [
      { name: 'Auth', description: 'Autenticación y sesión' },
      { name: 'Clients', description: 'Gestión de clientes publicitarios' },
      { name: 'Campaigns', description: 'Campañas publicitarias' },
      { name: 'Ads', description: 'Anuncios y archivos multimedia' },
      { name: 'Playlists', description: 'Listas de reproducción' },
      { name: 'Tablets', description: 'Dispositivos en campo' },
      { name: 'Stats', description: 'Métricas y estadísticas' },
      { name: 'Admin', description: 'Administración del sistema' },
      { name: 'Notes', description: 'Notas internas' },
      { name: 'Reminders', description: 'Recordatorios' },
      { name: 'Public API', description: 'API pública de sólo lectura (requiere X-API-Key)' },
    ],
  },
  apis: [],
});

// Inline path definitions (no JSDoc scanning needed — avoids filesystem issues)
swaggerSpec.paths = {
  '/api/health': { get: { tags: ['Admin'], summary: 'Health check', security: [], responses: { 200: { description: 'System health status' } } } },
  '/api/auth/login': { post: { tags: ['Auth'], summary: 'Login', security: [], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' } }, required: ['email', 'password'] } } } }, responses: { 200: { description: 'JWT token + user' }, 401: { description: 'Invalid credentials' } } } },
  '/api/auth/logout': { post: { tags: ['Auth'], summary: 'Logout', responses: { 204: { description: 'Logged out' } } } },
  '/api/auth/me': { get: { tags: ['Auth'], summary: 'Get current user', responses: { 200: { description: 'User object' } } } },
  '/api/clients': { get: { tags: ['Clients'], summary: 'List all active clients', responses: { 200: { description: 'Array of clients' } } }, post: { tags: ['Clients'], summary: 'Create a client', responses: { 201: { description: 'Created client' } } } },
  '/api/clients/{id}': { get: { tags: ['Clients'], summary: 'Get client profile with campaigns', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Client profile' }, 404: { description: 'Not found' } } }, put: { tags: ['Clients'], summary: 'Update client', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Updated client' } } }, delete: { tags: ['Clients'], summary: 'Soft-delete client', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Deleted' } } } },
  '/api/clients/{id}/proposal': { get: { tags: ['Clients'], summary: 'Download proposal PDF (#32)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'PDF file', content: { 'application/pdf': {} } } } } },
  '/api/campaigns': { get: { tags: ['Campaigns'], summary: 'List all campaigns', responses: { 200: { description: 'Array of campaigns' } } }, post: { tags: ['Campaigns'], summary: 'Create a campaign', responses: { 201: { description: 'Created campaign' } } } },
  '/api/campaigns/{id}': { get: { tags: ['Campaigns'], summary: 'Get campaign detail', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Campaign detail' } } }, put: { tags: ['Campaigns'], summary: 'Update campaign', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Updated' } } }, delete: { tags: ['Campaigns'], summary: 'Delete campaign', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Deleted' } } } },
  '/api/campaigns/{id}/certificate': { get: { tags: ['Campaigns'], summary: 'Download campaign certificate PDF (#51)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'PDF certificate', content: { 'application/pdf': {} } } } } },
  '/api/campaigns/{id}/contract': { get: { tags: ['Campaigns'], summary: 'Download digital contract PDF (#56)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'PDF contract', content: { 'application/pdf': {} } } } } },
  '/api/ads': { get: { tags: ['Ads'], summary: 'List all ads', responses: { 200: { description: 'Array of ads' } } } },
  '/api/tablets': { get: { tags: ['Tablets'], summary: 'List all tablets', responses: { 200: { description: 'Array of tablets' } } } },
  '/api/stats': { get: { tags: ['Stats'], summary: 'Global stats summary', responses: { 200: { description: 'Stats object' } } } },
  '/api/stats/monthly': { get: { tags: ['Stats'], summary: 'Monthly plays (last 12 months) (#38)', responses: { 200: { description: 'Array of {month, count}' } } } },
  '/api/stats/by-zone': { get: { tags: ['Stats'], summary: 'Plays and tablet count by zone', responses: { 200: { description: 'Array of zone stats' } } } },
  '/api/stats/sla': { get: { tags: ['Stats'], summary: 'SLA compliance per tablet (#59)', responses: { 200: { description: 'Array of SLA stats' } } } },
  '/api/stats/latency': { get: { tags: ['Stats'], summary: 'Endpoint latency summary (#43)', responses: { 200: { description: 'Latency summary' } } } },
  '/api/admin/backup': { get: { tags: ['Admin'], summary: 'Full JSON data backup (#42)', responses: { 200: { description: 'JSON backup file' } } } },
  '/api/admin/export/excel': { get: { tags: ['Admin'], summary: 'Multi-sheet Excel export (#64)', responses: { 200: { description: 'XLSX file' } } } },
  '/api/admin/export/pptx': { get: { tags: ['Admin'], summary: 'PowerPoint metrics export (#40)', responses: { 200: { description: 'PPTX file' } } } },
  '/api/admin/export/tablets': { get: { tags: ['Admin'], summary: 'Tablets CSV export', responses: { 200: { description: 'CSV file' } } } },
  '/api/admin/demo-seed': { post: { tags: ['Admin'], summary: 'Seed demo client + campaign (#63)', responses: { 201: { description: 'Demo data created' }, 409: { description: 'Already seeded' } } } },
  '/api/admin/api-keys': { get: { tags: ['Admin'], summary: 'List public API keys (#70)', responses: { 200: { description: 'Array of API keys (masked)' } } }, post: { tags: ['Admin'], summary: 'Create API key (#70)', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } } }, responses: { 201: { description: 'Created API key (full key shown once)' } } } },
  '/api/admin/api-keys/{id}': { delete: { tags: ['Admin'], summary: 'Revoke API key (#70)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Revoked' } } } },
  '/api/zones': { get: { tags: ['Admin'], summary: 'List geofence zones with tablet counts (#67)', responses: { 200: { description: 'Array of zones' } } }, post: { tags: ['Admin'], summary: 'Create zone (#67)', responses: { 201: { description: 'Created zone' } } } },
  '/api/zones/{id}': { put: { tags: ['Admin'], summary: 'Update zone (#67)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Updated zone' } } }, delete: { tags: ['Admin'], summary: 'Delete zone (#67)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Deleted' } } } },
  '/api/v1/public/stats': { get: { tags: ['Public API'], summary: 'Summary stats (requires X-API-Key header) (#70)', security: [{ apiKeyHeader: [] }], responses: { 200: { description: 'Stats object' }, 401: { description: 'No API key' }, 403: { description: 'Invalid key' } } } },
  '/api/v1/public/zones': { get: { tags: ['Public API'], summary: 'Zones with tablet counts (requires X-API-Key) (#70)', security: [{ apiKeyHeader: [] }], responses: { 200: { description: 'Array of zone stats' } } } },
  '/api/v1/public/campaigns': { get: { tags: ['Public API'], summary: 'Active campaigns list (requires X-API-Key) (#70)', security: [{ apiKeyHeader: [] }], responses: { 200: { description: 'Array of campaigns' } } } },
  '/api/notes': { get: { tags: ['Notes'], summary: 'List admin notes', responses: { 200: { description: 'Array of notes' } } }, post: { tags: ['Notes'], summary: 'Create note', responses: { 201: { description: 'Created note' } } } },
  '/api/reminders': { get: { tags: ['Reminders'], summary: 'List reminders', responses: { 200: { description: 'Array of reminders' } } }, post: { tags: ['Reminders'], summary: 'Create reminder', responses: { 201: { description: 'Created reminder' } } } },
  '/api/reminders/{id}': { patch: { tags: ['Reminders'], summary: 'Update reminder (toggle done, edit)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Updated reminder' } } }, delete: { tags: ['Reminders'], summary: 'Delete reminder', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 204: { description: 'Deleted' } } } },
};

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { customSiteTitle: 'ICON ADS API Docs' }));
app.get('/api/docs.json', (req, res) => res.json(swaggerSpec));

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
        // #10 — Webhook for tablet offline
        try {
          const cfg = await prisma.systemConfig.findUnique({ where: { key: 'webhook_url' } });
          if (cfg?.value) {
            fetch(cfg.value, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ event: 'tablet_offline', tabletId: t.id, name: t.name, zone: t.zone, lastSync: t.lastSync }),
            }).catch((e) => console.warn('[webhook] POST failed:', e.message));
          }
        } catch { /* non-fatal */ }
        // #53 — WhatsApp via CallMeBot
        try {
          const [phoneCfg, apikeyCfg] = await Promise.all([
            prisma.systemConfig.findUnique({ where: { key: 'callmebot_phone' } }),
            prisma.systemConfig.findUnique({ where: { key: 'callmebot_apikey' } }),
          ]);
          if (phoneCfg?.value && apikeyCfg?.value) {
            const text = encodeURIComponent(`ICON ADS: Tablet "${t.name}" (zona ${t.zone || 'sin zona'}) offline hace más de 2 horas.`);
            fetch(`https://api.callmebot.com/whatsapp.php?phone=${phoneCfg.value}&text=${text}&apikey=${apikeyCfg.value}`)
              .catch((e) => console.warn('[callmebot]', e.message));
          }
        } catch { /* non-fatal */ }
      } else if (!isOffline && alertedTablets.has(t.id)) {
        alertedTablets.delete(t.id);
        syslog.addEvent('TABLET_BACK_ONLINE', 'tablet', t.id, `${t.name} came back online`);
      }
    }
  } catch (err) {
    console.warn('[offline-check]', err.message);
  }
}, 30 * 60 * 1000);

// #69 — Nightly driver points recalculation
setInterval(async () => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const tablets = await prisma.tablet.findMany({ select: { id: true } });
    for (const t of tablets) {
      const syncs30d = await prisma.syncLog.count({ where: { tabletId: t.id, createdAt: { gte: thirtyDaysAgo }, success: true } });
      const bonus = syncs30d > 200 ? 50 : syncs30d > 100 ? 20 : 0;
      const points = syncs30d + bonus;
      await prisma.driverPoints.upsert({
        where: { tabletId: t.id },
        update: { points, syncs30d, lastCalculated: new Date() },
        create: { tabletId: t.id, points, syncs30d },
      });
    }
    console.log(`[driver-points] recalculados para ${tablets.length} tablets`);
  } catch (err) { console.warn('[driver-points]', err.message); }
}, 24 * 60 * 60 * 1000);

// #61 — WhatsApp via CallMeBot when campaign(s) expire today
setInterval(async () => {
  try {
    const [phoneCfg, apikeyCfg] = await Promise.all([
      prisma.systemConfig.findUnique({ where: { key: 'callmebot_phone' } }),
      prisma.systemConfig.findUnique({ where: { key: 'callmebot_apikey' } }),
    ]);
    if (!phoneCfg?.value || !apikeyCfg?.value) return;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const expiring = await prisma.campaign.findMany({
      where: { active: true, deletedAt: null, endDate: { gte: todayStart, lte: todayEnd } },
      include: { client: { select: { name: true } } },
    });
    if (expiring.length === 0) return;
    const names = expiring.map((c) => `"${c.name}" (${c.client?.name ?? '?'})`).join(', ');
    const text = encodeURIComponent(`ICON ADS: ${expiring.length} campaña(s) vence(n) hoy: ${names}`);
    fetch(`https://api.callmebot.com/whatsapp.php?phone=${phoneCfg.value}&text=${text}&apikey=${apikeyCfg.value}`)
      .catch((e) => console.warn('[callmebot-expire]', e.message));
    console.log(`[campaign-expire] ${expiring.length} campañas vencen hoy — WhatsApp enviado`);
  } catch (err) {
    console.warn('[campaign-expire]', err.message);
  }
}, 24 * 60 * 60 * 1000);

// #4 — Daily auto-archive expired campaigns (opt-in via settings)
setInterval(async () => {
  try {
    const cfg = await prisma.systemConfig.findUnique({ where: { key: 'auto_archive_expired' } });
    if (cfg?.value !== 'true') return;
    const now = new Date();
    const result = await prisma.campaign.updateMany({
      where: { endDate: { lt: now }, deletedAt: null },
      data: { active: false, deletedAt: now },
    });
    if (result.count > 0) {
      console.log(`[auto-archive] ${result.count} campañas vencidas archivadas`);
      syslog.addEvent('AUTO_ARCHIVE', 'campaign', null, `${result.count} campañas vencidas archivadas automáticamente`);
    }
  } catch (err) {
    console.warn('[auto-archive]', err.message);
  }
}, 24 * 60 * 60 * 1000);

// GPS location history cleanup — keep 7 days
setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deleted = await prisma.$executeRaw`DELETE FROM tablet_locations WHERE created_at < ${cutoff}`;
    if (deleted > 0) console.log(`[location-cleanup] ${deleted} registros GPS eliminados`);
  } catch (err) { console.warn('[location-cleanup]', err.message); }
}, 24 * 60 * 60 * 1000);

// #42 — Daily backup log
setInterval(async () => {
  try {
    const [clients, campaigns, ads, playlists, tablets] = await Promise.all([
      prisma.client.count({ where: { deletedAt: null } }),
      prisma.campaign.count({ where: { deletedAt: null } }),
      prisma.ad.count({ where: { deletedAt: null } }),
      prisma.playlist.count(),
      prisma.tablet.count(),
    ]);
    console.log(`[backup-log] ${new Date().toISOString()} — clients:${clients} campaigns:${campaigns} ads:${ads} playlists:${playlists} tablets:${tablets}`);
  } catch (err) {
    console.warn('[backup-log]', err.message);
  }
}, 24 * 60 * 60 * 1000);

// #12 — Daily metrics retention cleanup
setInterval(async () => {
  try {
    const cfg = await prisma.systemConfig.findUnique({ where: { key: 'metrics_retention_days' } });
    const days = Math.max(7, parseInt(cfg?.value ?? '90'));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const { count } = await prisma.metric.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (count > 0) console.log(`[cleanup] ${count} métricas eliminadas (retención: ${days}d)`);
  } catch (err) {
    console.warn('[cleanup]', err.message);
  }
}, 24 * 60 * 60 * 1000);

app.refreshMaintenanceMode = refreshMaintenanceMode;
module.exports = app;
