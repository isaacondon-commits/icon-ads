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
const { Readable } = require('stream');
const forceSyncFlags = require('../lib/forceSyncFlags');
const forceApkFlags = require('../lib/forceApkFlags');
const screenshotFlags = require('../lib/screenshotFlags');
const { resolveScheduleJson } = require('../lib/brightnessSchedule');

// Cuántos ZIP de playlist se pueden ARMAR a la vez. Ahora el armado es 100%
// streaming (no bufferiza los videos), así que la RAM ya no es el límite; el
// cuello es el ancho de banda a Supabase. 8 cubre la flota entera sin ahogarse.
const MAX_PACKAGE_BUILDS = 8;
let activePackageBuilds = 0;

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

    const { deviceId, name, zone, serial } = z.object({
      deviceId: z.string().min(1),
      name: z.string().min(1).optional(),
      zone: z.string().optional(),
      serial: z.string().optional(),
    }).parse(req.body);

    const existing = await prisma.tablet.findUnique({ where: { deviceId } });
    if (existing) {
      // Re-registration of an already-known device — logged for visibility since
      // this is the same call an attacker with a leaked deviceId would make.
      if (serial && serial !== existing.serial) {
        await prisma.tablet.update({ where: { id: existing.id }, data: { serial } }).catch(() => {});
      }
      await audit(req, 'DEVICE_REREGISTER', 'tablet', existing.id, `deviceId=${deviceId} ip=${req.ip}`);
      return res.json({ token: existing.token, tabletId: existing.id });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tablet = await prisma.tablet.create({
      data: { deviceId, name: name || deviceId, zone, token, serial: serial || null },
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

// GET /api/device/apk-version — latest published APK, for in-app auto-update
// (#apk-autoupdate). Absent url/versionCode means no APK has been published
// yet — the app just keeps running its current build.
router.get('/apk-version', requireDevice, async (req, res, next) => {
  try {
    const configs = await prisma.systemConfig.findMany({
      where: { key: { in: ['apk_version_code', 'apk_version_name', 'apk_url'] } },
    });
    const map = Object.fromEntries(configs.map((c) => [c.key, c.value]));
    // Señal one-shot de "re-chequeá aunque ya hayas intentado esta versión"
    // (seteada por POST /api/admin/force-update-apk).
    const force = forceApkFlags.has(req.tablet.id);
    if (force) forceApkFlags.delete(req.tablet.id);
    res.json({
      versionCode: map.apk_version_code ? Number(map.apk_version_code) : null,
      versionName: map.apk_version_name ?? null,
      url: map.apk_url ?? null,
      force,
    });
  } catch (err) {
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
    const brightness = req.query.brightness !== undefined ? parseInt(req.query.brightness) : undefined;
    const brightnessAuto = req.query.brightnessAuto !== undefined ? req.query.brightnessAuto === 'true' : undefined;
    const serial = req.query.serial || undefined;
    const playerOk = req.query.playerOk !== undefined ? req.query.playerOk === 'true' : undefined;
    const lastAdAgoS = req.query.lastAdAgoS !== undefined ? parseInt(req.query.lastAdAgoS) : undefined;
    // onFallback: la app está mostrando SÓLO el video institucional de respaldo
    // (campaignId < 0) => no logró cargar/descargar su playlist real.
    const onFallback = req.query.onFallback !== undefined ? req.query.onFallback === 'true' : undefined;
    // Brillo automático manejado por la app: lux medido y si la tablet tiene
    // sensor de luz (si no lo tiene, el brillo auto no puede adaptar).
    const lux = req.query.lux !== undefined ? parseFloat(req.query.lux) : undefined;
    const lightSensor = req.query.lightSensor !== undefined ? req.query.lightSensor === 'true' : undefined;
    // Qué playlist tiene instalada la tablet (APK >= 1.40). Sirve para NO
    // re-descargar cuando la playlist asignada es la misma que ya está
    // reproduciendo — sólo baja si le asignaron OTRA, o si esa misma playlist
    // tuvo una edición real (sube de versión).
    const installedPlaylistId = req.query.installedPlaylistId !== undefined
      ? parseInt(req.query.installedPlaylistId) : undefined;
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
        ...(Number.isFinite(brightness) ? { brightness } : {}),
        ...(brightnessAuto !== undefined ? { brightnessAuto } : {}),
        ...(serial !== undefined ? { serial } : {}),
        ...(playerOk !== undefined ? { playerOk } : {}),
        ...(Number.isFinite(lastAdAgoS) ? { lastAdAgoS } : {}),
        ...(onFallback !== undefined ? { onFallback } : {}),
        ...(Number.isFinite(lux) ? { lux } : {}),
        ...(lightSensor !== undefined ? { lightSensor } : {}),
      },
    });

    // Record sync in history (#1)
    prisma.syncLog.create({ data: { tabletId: tablet.id, version: currentVersion, success: true } }).catch(() => {});

    // Se hace "peek" (no se consume): el flag lo consume GET /apk-version. Sólo
    // le avisamos al loop de 30 s de la app que encole un SyncWorker ya, sin
    // depender del push FCM.
    const forceApkCheck = forceApkFlags.has(tablet.id);

    // Modo test (systemConfig kiosk_test_mode): la tablet ignora el desenchufe
    // y el cierre por inactividad — queda como kiosco siempre prendido y el
    // botón de encendido hace on/off manual. Se prende/apaga desde
    // POST /api/admin/test-mode.
    const tmRow = await prisma.systemConfig.findUnique({ where: { key: 'kiosk_test_mode' } });
    const testMode = tmRow?.value === '1';
    // Política de brillo remota (systemConfig screen_brightness): 'auto' o un
    // número 0-255. Ausente => 'auto'. Se setea desde POST /api/admin/brightness.
    const brRow = await prisma.systemConfig.findUnique({ where: { key: 'screen_brightness' } });
    const brightnessPolicy = brRow?.value || 'auto';
    // Tabla de brillo por horario solar (systemConfig brightness_schedule). La
    // app la usa cuando brightnessPolicy === 'auto' y no hay sensor de luz.
    const bsRow = await prisma.systemConfig.findUnique({ where: { key: 'brightness_schedule' } });
    const brightnessSchedule = resolveScheduleJson(bsRow?.value);
    // Sólo la Activity del player (que manda appVersion/playerOk) puede sacar
    // la captura — el SyncWorker no. Así el flag no se "consume" en un sync
    // del worker sin que nadie fotografíe.
    const isPlayerSync = playerOk !== undefined || appVersion !== undefined;
    const screenshotRequested = isPlayerSync && screenshotFlags.has(tablet.id);
    if (screenshotRequested) screenshotFlags.delete(tablet.id);
    // El operador bloqueó esta tablet desde el panel (manualStatus). La app
    // frena la reproducción y muestra una pantalla neutra hasta que se
    // desbloquee — pero sigue sincronizando normalmente.
    const blocked = tablet.manualStatus === 'bloqueada';

    if (!tablet.playlistId) {
      console.log(`[sync] tablet=${tablet.id} → sin playlist asignada`);
      return res.json({ needsUpdate: false, version: 0, message: 'No playlist assigned', rotated180: tablet.rotated180, forceApkCheck, testMode, brightnessPolicy, screenshotRequested, blocked, brightnessSchedule });
    }

    const playlist = await prisma.playlist.findUnique({ where: { id: tablet.playlistId } });
    if (!playlist) {
      console.log(`[sync] tablet=${tablet.id} → playlist ${tablet.playlistId} no encontrada en DB`);
      return res.json({ needsUpdate: false, version: 0, rotated180: tablet.rotated180, forceApkCheck, testMode, brightnessPolicy, screenshotRequested, blocked, brightnessSchedule });
    }

    // #48 — el admin forzó un sync desde el panel: baja sí o sí.
    const forced = forceSyncFlags.has(tablet.id);
    if (forced) forceSyncFlags.delete(tablet.id);

    // Cuándo re-descargar:
    //  - APK nuevo (manda installedPlaylistId): baja si le asignaron OTRA
    //    playlist, o si es LA MISMA pero subió de versión (edición real). Si la
    //    playlist asignada es la que ya está reproduciendo y no cambió → NO baja.
    //  - APK viejo (no manda installedPlaylistId): lógica por versión de siempre.
    const knowsInstalledPlaylist = Number.isInteger(installedPlaylistId);
    const differentPlaylist = knowsInstalledPlaylist && installedPlaylistId !== tablet.playlistId;
    const newerVersion = playlist.version > currentVersion;
    const needsUpdate = forced || differentPlaylist || newerVersion;

    if (!needsUpdate) {
      console.log(`[sync] tablet=${tablet.id} → playlist ${tablet.playlistId} v${playlist.version} sin cambios`);
      return res.json({ needsUpdate: false, version: playlist.version, rotated180: tablet.rotated180, forceApkCheck, testMode, brightnessPolicy, screenshotRequested, blocked, brightnessSchedule });
    }

    const motivo = forced ? 'forzado' : differentPlaylist ? `otra playlist (${installedPlaylistId}→${tablet.playlistId})` : `v${currentVersion}→v${playlist.version}`;
    console.log(`[sync] tablet=${tablet.id} → descarga: ${motivo}`);
    res.json({
      needsUpdate: true,
      version: playlist.version,
      packageUrl: `/api/device/package/${playlist.version}`,
      rotated180: tablet.rotated180,
      forceApkCheck,
      testMode,
      brightnessPolicy,
      screenshotRequested,
      blocked,
      brightnessSchedule,
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

    // Sólo anuncios activos, no borrados y aprobados. Se dedupe por filename para
    // que un mismo archivo no entre dos veces al ZIP (aunque el anuncio esté
    // repetido en la lista, cosa que sí se refleja en adsPayload/orden).
    const activeAds = playlist.playlistAds
      .filter(({ ad }) => ad.active && !ad.deletedAt && ad.approvalStatus === 'approved')
      .map(({ ad, order }) => ({ ad, order }));

    const adsPayload = activeAds.map(({ ad, order }) => ({
      id: ad.id, name: ad.name, type: ad.type, filename: ad.filename,
      duration_s: ad.durationS, order, campaignId: ad.campaignId,
    }));

    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ version: playlist.version, ads: adsPayload }))
      .digest('hex');

    const cachedZip = path.join(cacheDir, `playlist_${playlist.id}_${hash}.zip`);

    console.log(`[package] tablet=${tablet.id} playlist=${playlist.id} v${playlist.version} ads=${adsPayload.length} hash=${hash.slice(0, 8)}`);

    // Cache hit: el ZIP ya generado y completo se sirve tal cual.
    if (playlist.contentHash === hash && fs.existsSync(cachedZip)) {
      console.log(`[package] cache hit — sirviendo desde disco`);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="playlist_v${playlist.version}.zip"`);
      res.setHeader('X-Playlist-Hash', hash);
      return fs.createReadStream(cachedZip).pipe(res);
    }

    // Tope de concurrencia: si ya hay varios armándose, esta tablet reintenta.
    if (activePackageBuilds >= MAX_PACKAGE_BUILDS) {
      console.log(`[package] ${activePackageBuilds} builds activos — 503, que reintente`);
      return res.status(503).json({ error: 'Servidor ocupado armando paquetes. Reintentar.' });
    }

    // Archivos únicos por filename (un mismo video no entra dos veces al ZIP).
    const seen = new Set();
    const uniqueAds = [];
    for (const { ad } of activeAds) {
      if (seen.has(ad.filename)) continue;
      seen.add(ad.filename);
      uniqueAds.push(ad);
    }

    // Pre-chequeo LIVIANO (sin bajar el archivo): un GET con Range 0-0 a cada
    // URL para confirmar que existe y no está vacía. Si falta alguno → 503 y la
    // tablet reintenta; nunca se arma un ZIP incompleto. Sin buffers en RAM.
    const CHECK_TIMEOUT_MS = 15000;
    const sources = [];
    try {
      await Promise.all(uniqueAds.map(async (ad) => {
        const filePath = path.join(uploadDir, ad.filename);
        if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
          sources.push({ name: `media/${ad.filename}`, filePath });
          return;
        }
        if (!ad.fileUrl || !/^https?:\/\//.test(ad.fileUrl)) {
          throw new Error(`${ad.filename}: sin archivo ni URL`);
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
        try {
          const head = await fetch(ad.fileUrl, { headers: { Range: 'bytes=0-0' }, signal: ctrl.signal });
          if (!head.ok && head.status !== 206) throw new Error(`${ad.filename}: HTTP ${head.status}`);
          const len = head.headers.get('content-range') || head.headers.get('content-length');
          if (len && /(?:\/|^)0$/.test(String(len).trim())) throw new Error(`${ad.filename}: vacío`);
          if (head.body) { try { await head.body.cancel(); } catch { /* ignore */ } }
        } finally {
          clearTimeout(timer);
        }
        sources.push({ name: `media/${ad.filename}`, url: ad.fileUrl });
      }));
    } catch (e) {
      console.warn(`[package] media incompleta — 503: ${e.message}`);
      return res.status(503).json({ error: `Media incompleta (${e.message}). Reintentar.` });
    }

    activePackageBuilds++;
    let doneAccounting = false;
    const releaseSlot = () => { if (!doneAccounting) { doneAccounting = true; activePackageBuilds--; } };

    console.log(`[package] generando ZIP (${sources.length} archivos) [${activePackageBuilds} activos]…`);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="playlist_v${playlist.version}.zip"`);
    res.setHeader('X-Playlist-Hash', hash);

    const playlistJson = JSON.stringify(
      { playlistId: playlist.id, playlistName: playlist.name, version: playlist.version, hash, generatedAt: new Date().toISOString(), ads: adsPayload }, null, 2
    );

    // Sin recompresión: los videos/imágenes ya vienen comprimidos.
    // Se escribe a un .tmp en disco EN STREAMING (no se junta el ZIP en RAM) y
    // recién al terminar OK se renombra al cache y se marca el contentHash.
    // DEFLATE nivel 1 (rápido). NO 'store: true' — el ZipInputStream del ROM
    // Unisoc de estas tablets extrae mal las entradas STORED (videos negros); con
    // DEFLATE anda, igual que el código viejo (que usaba nivel 6).
    const archive = archiver('zip', { zlib: { level: 1 } });
    const tmpZip = `${cachedZip}.tmp.${process.pid}.${Date.now()}`;
    const diskOut = fs.createWriteStream(tmpZip);
    let failed = false;
    const fail = (why) => {
      if (failed) return;
      failed = true;
      console.error(`[package] fallo armando ZIP: ${why}`);
      releaseSlot();
      try { archive.abort(); } catch { /* ignore */ }
      try { fs.unlink(tmpZip, () => {}); } catch { /* ignore */ }
      if (!res.writableEnded) res.destroy();
    };
    archive.on('error', (err) => fail(err.message));
    diskOut.on('error', (err) => fail(`disco: ${err.message}`));
    res.on('error', () => fail('res error'));
    res.on('close', () => { if (!res.writableEnded) fail('cliente cortó'); });
    archive.pipe(res);
    archive.pipe(diskOut);

    archive.on('end', () => {
      releaseSlot();
      if (failed) { fs.unlink(tmpZip, () => {}); return; }
      fs.rename(tmpZip, cachedZip, async (renErr) => {
        if (renErr) { console.warn('[package] no se pudo cachear:', renErr.message); return; }
        try {
          await prisma.playlist.update({ where: { id: playlist.id }, data: { contentHash: hash } });
          console.log('[package] cache guardado');
        } catch { /* non-fatal */ }
      });
    });
    archive.on('close', releaseSlot);

    // Guard duro: si armar el ZIP entero tarda demasiado, se aborta (evita
    // requests colgados y que la tablet quede esperando la descarga).
    const buildDeadline = setTimeout(() => fail('timeout total armando ZIP'), 90_000);
    // Archivos remotos: se bajan a un temp en disco y se meten al ZIP con
    // archive.file() (tamaño conocido, headers de ZIP correctos). Con streams de
    // largo desconocido, archiver armaba entradas que el ZipInputStream del ROM
    // Unisoc extraía CORRUPTAS → videos negros. Disco, no RAM.
    const tmpMedia = [];
    const cleanupTmp = () => { for (const p of tmpMedia) fs.unlink(p, () => {}); };
    archive.on('end', cleanupTmp);
    archive.on('close', cleanupTmp);
    try {
      archive.append(playlistJson, { name: 'playlist.json' });
      for (const s of sources) {
        if (failed) break;
        if (s.filePath) {
          archive.file(s.filePath, { name: s.name });
          continue;
        }
        const dl = path.join(cacheDir, `dl_${process.pid}_${Date.now()}_${path.basename(s.name)}`);
        tmpMedia.push(dl);
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 45_000);
        try {
          const remote = await fetch(s.url, { signal: ctrl.signal });
          if (!remote.ok || !remote.body) { fail(`${s.name}: HTTP ${remote.status}`); break; }
          await new Promise((resolve, reject) => {
            const ws = fs.createWriteStream(dl);
            ws.on('error', reject);
            ws.on('finish', resolve);
            Readable.fromWeb(remote.body).on('error', reject).pipe(ws);
          });
        } finally { clearTimeout(t); }
        const sz = fs.existsSync(dl) ? fs.statSync(dl).size : 0;
        if (sz === 0) { fail(`${s.name}: descarga vacía`); break; }
        archive.file(dl, { name: s.name });
      }
      if (!failed) archive.finalize();
    } catch (e) {
      fail(e.message);
      cleanupTmp();
    } finally {
      clearTimeout(buildDeadline);
    }
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

// POST /api/device/screenshot — la tablet sube una captura de su pantalla
// cuando el panel la pidió (data URI JPEG base64). Sólo se guarda la última.
router.post('/screenshot', requireDevice, async (req, res, next) => {
  try {
    const image = String(req.body?.image || '');
    if (!image.startsWith('data:image/') || image.length > 600_000) {
      return res.status(400).json({ error: 'Imagen inválida o demasiado grande' });
    }
    await prisma.tablet.update({
      where: { id: req.tablet.id },
      data: { lastScreenshot: image, lastScreenshotAt: new Date() },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
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
