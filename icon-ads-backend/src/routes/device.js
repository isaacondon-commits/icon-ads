const router = require('express').Router();
const { z } = require('zod');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const prisma = require('../lib/prisma');
const { requireDevice } = require('../middleware/deviceAuth');
const forceSyncFlags = require('../lib/forceSyncFlags');

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
router.post('/register', async (req, res, next) => {
  try {
    const { deviceId, name, zone } = z.object({
      deviceId: z.string().min(1),
      name: z.string().min(1).optional(),
      zone: z.string().optional(),
    }).parse(req.body);

    const existing = await prisma.tablet.findUnique({ where: { deviceId } });
    if (existing) {
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

// GET /api/device/sync?version=N — check if the tablet needs a new package
router.get('/sync', requireDevice, async (req, res, next) => {
  try {
    const currentVersion = parseInt(req.query.version) || 0;
    const tablet = req.tablet;

    await prisma.tablet.update({
      where: { id: tablet.id },
      data: { status: 'online', lastSync: new Date() },
    });

    if (!tablet.playlistId) {
      return res.json({ needsUpdate: false, version: 0, message: 'No playlist assigned' });
    }

    const playlist = await prisma.playlist.findUnique({ where: { id: tablet.playlistId } });
    if (!playlist) {
      return res.json({ needsUpdate: false, version: 0 });
    }

    // #48 — if admin forced a sync, override version check
    const forced = forceSyncFlags.has(tablet.id);
    if (forced) forceSyncFlags.delete(tablet.id);

    if (!forced && playlist.version <= currentVersion) {
      return res.json({ needsUpdate: false, version: playlist.version });
    }

    res.json({
      needsUpdate: true,
      version: playlist.version,
      packageUrl: `/api/device/package/${playlist.version}`,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/device/package/:version — download ZIP with playlist.json + media files
router.get('/package/:version', requireDevice, async (req, res, next) => {
  try {
    const tablet = req.tablet;
    if (!tablet.playlistId) return res.status(404).json({ error: 'No playlist assigned' });

    const playlist = await prisma.playlist.findUnique({
      where: { id: tablet.playlistId },
      include: {
        playlistAds: {
          include: { ad: true },
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

    const uploadDir = path.join(__dirname, '../../uploads');

    // Build playlist.json — hash is over the ads content (not the ZIP)
    const adsPayload = playlist.playlistAds.map(({ ad, order }) => ({
      id: ad.id,
      name: ad.name,
      type: ad.type,
      filename: ad.filename,
      duration_s: ad.durationS,
      order,
      campaignId: ad.campaignId,
    }));

    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ version: playlist.version, ads: adsPayload }))
      .digest('hex');

    const playlistJson = JSON.stringify(
      { version: playlist.version, hash, generatedAt: new Date().toISOString(), ads: adsPayload },
      null,
      2
    );

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="playlist_v${playlist.version}.zip"`
    );
    res.setHeader('X-Playlist-Hash', hash);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', next);
    archive.pipe(res);
    archive.append(playlistJson, { name: 'playlist.json' });

    for (const { ad } of playlist.playlistAds) {
      const filePath = path.join(uploadDir, ad.filename);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: `media/${ad.filename}` });
      }
    }

    await archive.finalize();
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

    res.json({ saved: metrics.length });
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
