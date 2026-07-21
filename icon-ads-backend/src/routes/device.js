const router = require('express').Router();
const { z } = require('zod');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const rateLimit = require('express-rate-limit');
const prisma = require('../lib/prisma');
const { requireDevice } = require('../middleware/deviceAuth');
const { audit } = require('../lib/auditLog');
const forceSyncFlags = require('../lib/forceSyncFlags');

// Registration re-issues the existing token for a known deviceId with no further
// proof of possession (deviceId — Android's ANDROID_ID — isn't a secret). Keying
// this limiter by deviceId (not IP) slows down someone hammering one known/guessed
// deviceId to harvest its token, without throttling legitimate bulk provisioning
// of many different tablets from the same site/IP.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (typeof req.body?.deviceId === 'string' && req.body.deviceId) || req.ip,
  message: { error: 'Demasiados intentos de registro para este dispositivo. Intentá de nuevo en 1 hora.' },
});

const metricsSchema = z.array(
  z.object({
    adId: z.number().int().positive(),
    campaignId: z.number().int().positive(),
    playedAt: z.string().datetime(),
    durationPlayedS: z.number().int().min(0),
    completed: z.boolean(),
    error: z.boolean().default(false),
  })
);

const errorSchema = z.object({
  errorType: z.string().min(1),
  message: z.string().min(1),
  occurredAt: z.string().datetime(),
});

// POST /api/device/register — first call from a new device
router.post('/register', registerLimiter, async (req, res, next) => {
  try {
    // Optional: require a shared enrollment key baked into the APK (X-Enrollment-Key).
    // deviceId (Android's ANDROID_ID) isn't secret, so without this check anyone who
    // obtains a deviceId could re-register and get back that tablet's live token.
    // Skipped entirely if ENROLLMENT_SECRET isn't configured, so this stays opt-in
    // until it's set on the server and rolled out to the fleet's APK.
    if (process.env.ENROLLMENT_SECRET) {
      const key = req.headers['x-enrollment-key'];
      if (key !== process.env.ENROLLMENT_SECRET) {
        console.warn(`[SECURITY] Register rechazado — enrollment key inválida, ip=${req.ip}`);
        return res.status(401).json({ error: 'Invalid enrollment key' });
      }
    }

    const { deviceId, name, zone } = z.object({
      deviceId: z.string().min(1),
      name: z.string().min(1).optional(),
      zone: z.string().optional(),
    }).parse(req.body);

    const existing = await prisma.tablet.findUnique({ where: { deviceId } });
    if (existing) {
      // Re-registration of an already-known device — logged for visibility since
      // this is the same call an attacker with a leaked deviceId would make.
      await audit(req, 'DEVICE_REREGISTER', 'tablet', existing.id, `deviceId=${deviceId} ip=${req.ip}`);
      return res.json({ token: existing.token, tabletId: existing.id });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tablet = await prisma.tablet.create({
      data: { deviceId, name: name || deviceId, zone, token },
    });
    res.status(201).json({ token: tablet.token, tabletId: tablet.id });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// POST /api/device/fcm-token — register/refresh the push token used for instant force-sync
router.post('/fcm-token', requireDevice, async (req, res, next) => {
  try {
    const { token } = z.object({ token: z.string().min(1) }).parse(req.body);
    await prisma.tablet.update({ where: { id: req.tablet.id }, data: { fcmToken: token } });
    res.json({ ok: true });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// GET /api/device/sync?version=N — check if the tablet needs a new package
router.get('/sync', requireDevice, async (req, res, next) => {
  try {
    const currentVersion = parseInt(req.query.version) || 0;
    const batteryLevel = req.query.battery !== undefined ? parseInt(req.query.battery) : undefined;
    const temperatureC = req.query.temp !== undefined ? parseFloat(req.query.temp) : undefined;
    const appVersion = req.query.appVersion || undefined;
    const osVersion = req.query.osVersion || undefined;
    const deviceModel = req.query.deviceModel || undefined;
    const tablet = req.tablet;

    console.log(`[sync] tablet=${tablet.id} (${tablet.name}) versión local=${currentVersion} battery=${batteryLevel ?? '?'}% temp=${temperatureC ?? '?'}°C`);

    const clientIp = req.ip ?? req.socket?.remoteAddress ?? null;
    await prisma.tablet.update({
      where: { id: tablet.id },
      data: {
        status: 'online', lastSync: new Date(),
        lastIp: clientIp,
        ...(batteryLevel !== undefined ? { batteryLevel } : {}),
        ...(temperatureC !== undefined ? { temperatureC } : {}),
        ...(appVersion !== undefined ? { appVersion } : {}),
        ...(osVersion !== undefined ? { osVersion } : {}),
        ...(deviceModel !== undefined ? { deviceModel } : {}),
      },
    });

    // Record sync in history (#1)
    prisma.syncLog.create({ data: { tabletId: tablet.id, version: currentVersion, success: true } }).catch(() => {});

    if (!tablet.playlistId) {
      console.log(`[sync] tablet=${tablet.id} → sin playlist asignada`);
      return res.json({ needsUpdate: false, version: 0, message: 'No playlist assigned', rotated180: tablet.rotated180 });
    }

    const playlist = await prisma.playlist.findUnique({ where: { id: tablet.playlistId } });
    if (!playlist) {
      console.log(`[sync] tablet=${tablet.id} → playlist ${tablet.playlistId} no encontrada en DB`);
      return res.json({ needsUpdate: false, version: 0, rotated180: tablet.rotated180 });
    }

    // #48 — if admin forced a sync, override version check
    const forced = forceSyncFlags.has(tablet.id);
    if (forced) forceSyncFlags.delete(tablet.id);

    if (!forced && playlist.version <= currentVersion) {
      console.log(`[sync] tablet=${tablet.id} → ya en v${playlist.version}, sin cambios`);
      return res.json({ needsUpdate: false, version: playlist.version, rotated180: tablet.rotated180 });
    }

    console.log(`[sync] tablet=${tablet.id} → actualización disponible v${currentVersion}→v${playlist.version}`);
    res.json({
      needsUpdate: true,
      version: playlist.version,
      packageUrl: `/api/device/package/${playlist.version}`,
      rotated180: tablet.rotated180,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/device/package/:version — download ZIP (cached by content hash) (#31)
router.get('/package/:version', requireDevice, async (req, res, next) => {
  try {
    const tablet = req.tablet;
    if (!tablet.playlistId) return res.status(404).json({ error: 'No playlist assigned' });

    const playlist = await prisma.playlist.findUnique({
      where: { id: tablet.playlistId },
      include: { playlistAds: { include: { ad: true }, orderBy: { order: 'asc' } } },
    });
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

    const uploadDir = path.join(__dirname, '../../uploads');
    const cacheDir = path.join(__dirname, '../../cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    // Only include active, non-deleted, approved ads
    const adsPayload = playlist.playlistAds
      .filter(({ ad }) => ad.active && !ad.deletedAt && ad.approvalStatus === 'approved')
      .map(({ ad, order }) => ({
        id: ad.id, name: ad.name, type: ad.type, filename: ad.filename,
        duration_s: ad.durationS, order, campaignId: ad.campaignId,
      }));

    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ version: playlist.version, ads: adsPayload }))
      .digest('hex');

    const cachedZip = path.join(cacheDir, `playlist_${playlist.id}_${hash}.zip`);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="playlist_v${playlist.version}.zip"`);
    res.setHeader('X-Playlist-Hash', hash);

    console.log(`[package] tablet=${tablet.id} playlist=${playlist.id} v${playlist.version} ads=${playlist.playlistAds.length} hash=${hash.slice(0, 8)}`);

    // Serve from cache if hash matches (#31)
    if (playlist.contentHash === hash && fs.existsSync(cachedZip)) {
      console.log(`[package] cache hit — sirviendo desde disco`);
      return fs.createReadStream(cachedZip).pipe(res);
    }

    console.log(`[package] generando ZIP…`);
    const playlistJson = JSON.stringify(
      { version: playlist.version, hash, generatedAt: new Date().toISOString(), ads: adsPayload }, null, 2
    );

    // Pipe archive directly to response; collect chunks to cache in background
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      console.error('[package] archive error:', err.message);
      if (!res.writableEnded) next(err);
    });

    // Stream directly to client — this is the fix; never buffer-then-serve
    archive.pipe(res);

    // Simultaneously collect chunks for disk cache
    const cacheChunks = [];
    archive.on('data', (chunk) => cacheChunks.push(Buffer.from(chunk)));
    archive.on('end', () => {
      const buf = Buffer.concat(cacheChunks);
      console.log(`[package] ZIP enviado — ${(buf.length / 1024).toFixed(1)} KB`);
      fs.writeFile(cachedZip, buf, async (writeErr) => {
        if (writeErr) { console.warn('[package] no se pudo cachear ZIP:', writeErr.message); return; }
        try {
          await prisma.playlist.update({ where: { id: playlist.id }, data: { contentHash: hash } });
          console.log(`[package] cache guardado`);
        } catch { /* non-fatal */ }
      });
    });

    archive.append(playlistJson, { name: 'playlist.json' });
    for (const { ad } of playlist.playlistAds) {
      const filePath = path.join(uploadDir, ad.filename);
      if (fs.existsSync(filePath)) {
        console.log(`[package] + media/${ad.filename} (disco)`);
        archive.file(filePath, { name: `media/${ad.filename}` });
        continue;
      }
      // Storage migrated to Supabase/R2 (#41) — file isn't on local disk, fetch it
      // from its public URL instead of skipping it silently.
      if (ad.fileUrl && /^https?:\/\//.test(ad.fileUrl)) {
        try {
          const remote = await fetch(ad.fileUrl);
          if (!remote.ok) throw new Error(`HTTP ${remote.status}`);
          const buf = Buffer.from(await remote.arrayBuffer());
          console.log(`[package] + media/${ad.filename} (remoto, ${(buf.length / 1024).toFixed(0)} KB)`);
          archive.append(buf, { name: `media/${ad.filename}` });
        } catch (fetchErr) {
          console.warn(`[package] no se pudo descargar ${ad.fileUrl}: ${fetchErr.message}`);
        }
        continue;
      }
      console.warn(`[package] archivo no encontrado: ${filePath}`);
    }
    archive.finalize();
  } catch (err) {
    next(err);
  }
});

// POST /api/device/metrics — batch upload playback metrics
router.post('/metrics', requireDevice, async (req, res, next) => {
  try {
    const metrics = metricsSchema.parse(req.body);
    const tabletId = req.tablet.id;

    await prisma.metric.createMany({
      data: metrics.map((m) => ({
        tabletId,
        adId: m.adId,
        campaignId: m.campaignId,
        playedAt: new Date(m.playedAt),
        durationPlayedS: m.durationPlayedS,
        completed: m.completed,
        error: m.error,
      })),
    });

    // Auto-pause campaigns that reached max_impressions (#7)
    const uniqueCampaignIds = [...new Set(metrics.map((m) => m.campaignId))];
    for (const campaignId of uniqueCampaignIds) {
      try {
        const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { maxImpressions: true, active: true } });
        if (!campaign?.maxImpressions || !campaign.active) continue;
        const total = await prisma.metric.count({ where: { campaignId } });
        if (total >= campaign.maxImpressions) {
          await prisma.campaign.update({ where: { id: campaignId }, data: { active: false } });
          console.log(`[metrics] Campaña ${campaignId} autopausada: ${total}/${campaign.maxImpressions} impresiones`);
        }
      } catch { /* non-fatal */ }
    }

    res.json({ saved: metrics.length });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// GET /api/device/messages — pending admin messages for this tablet (#4)
router.get('/messages', requireDevice, async (req, res, next) => {
  try {
    const messages = await prisma.tabletMessage.findMany({
      where: { tabletId: req.tablet.id, shown: false },
      orderBy: { createdAt: 'asc' },
    });
    if (messages.length > 0) {
      await prisma.tabletMessage.updateMany({
        where: { id: { in: messages.map((m) => m.id) } },
        data: { shown: true },
      });
    }
    res.json(messages.map((m) => ({ id: m.id, message: m.message, createdAt: m.createdAt })));
  } catch (err) {
    next(err);
  }
});

// POST /api/device/location — GPS position upload
router.post('/location', requireDevice, async (req, res, next) => {
  try {
    const { lat, lng, accuracy, timestamp } = z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracy: z.number().min(0).optional(),
      timestamp: z.string().datetime().optional(),
    }).parse(req.body);
    const tabletId = req.tablet.id;
    const ts = timestamp ? new Date(timestamp) : new Date();
    await prisma.$executeRaw`
      INSERT INTO tablet_locations (tablet_id, lat, lng, accuracy, created_at)
      VALUES (${tabletId}, ${lat}, ${lng}, ${accuracy ?? null}, ${ts})
    `;
    await prisma.$executeRaw`
      UPDATE tablets SET last_lat = ${lat}, last_lng = ${lng} WHERE id = ${tabletId}
    `;
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// GET /api/device/survey — active survey not yet answered by this tablet (#47)
router.get('/survey', requireDevice, async (req, res, next) => {
  try {
    const tabletId = req.tablet.id;
    const [survey] = await prisma.$queryRaw`
      SELECT s.id, s.question, s.options FROM surveys s
      WHERE s.active = true
      AND NOT EXISTS (
        SELECT 1 FROM survey_answers sa
        WHERE sa.survey_id = s.id AND sa.tablet_id = ${tabletId}
      )
      ORDER BY s.created_at DESC LIMIT 1
    `;
    if (!survey) return res.status(204).send();
    res.json({ id: survey.id, question: survey.question, options: survey.options });
  } catch (err) { next(err); }
});

// POST /api/device/survey-answer — submit survey answer (#47)
router.post('/survey-answer', requireDevice, async (req, res, next) => {
  try {
    const { surveyId, optionIndex } = z.object({
      surveyId: z.number().int().positive(),
      optionIndex: z.number().int().min(0).max(3),
    }).parse(req.body);
    const tabletId = req.tablet.id;
    await prisma.$executeRaw`
      INSERT INTO survey_answers (survey_id, tablet_id, option_index, answered_at)
      VALUES (${surveyId}, ${tabletId}, ${optionIndex}, NOW())
      ON CONFLICT (survey_id, tablet_id) DO UPDATE SET option_index = EXCLUDED.option_index, answered_at = NOW()
    `;
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// POST /api/device/error — log a device-side error
router.post('/error', requireDevice, async (req, res, next) => {
  try {
    const { errorType, message, occurredAt } = errorSchema.parse(req.body);
    await prisma.errorLog.create({
      data: { tabletId: req.tablet.id, errorType, message, occurredAt: new Date(occurredAt) },
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

module.exports = router;
