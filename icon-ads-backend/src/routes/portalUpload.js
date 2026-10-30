// Subida de anuncios desde el portal de empresas.
//
// El archivo no pasa por el proxy de Vercel (tope ~4,5 MB): el navegador lo
// manda directo acá con un permiso de un solo uso que pidió por el proxy
// (POST /api/portal/upload-ticket). La empresa sale del permiso, nunca del
// formulario. El anuncio entra PENDIENTE de aprobación y sin playlists: no se
// reproduce hasta que un admin lo apruebe y lo ponga en una playlist.

const router = require('express').Router();
const fs = require('fs');
const multer = require('multer');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { sendAlert } = require('../lib/alerts');
const { mp4DurationSeconds } = require('../lib/mp4Duration');
const { requireUploadTicket, logPortalEvent } = require('../lib/portalAuth');
const { MAX_S, maxSecondsForClient } = require('../lib/portalLimits');
const { IMAGE_MAX, VIDEO_MAX, ALLOWED_EXT, detectMimeFromBuffer, compressImage, storeAdFile } = require('../lib/adFile');

const MAX_PENDING_UPLOADS = 10;

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (ALLOWED_EXT.test(file.originalname)) cb(null, true);
    else cb(Object.assign(new Error('Tipo de archivo no permitido. Aceptados: MP4, JPG, PNG o WEBP.'), { status: 400 }));
  },
  limits: { fileSize: VIDEO_MAX, files: 1, fields: 10 },
});

const fieldsSchema = z.object({
  publicName: z.string().trim().min(1, 'Poné un nombre para el anuncio.').max(120, 'El nombre es muy largo (máximo 120).'),
  // Imágenes: cuánto tiempo se muestran. Videos: lo que midió el navegador
  // (sólo se usa si no se puede leer del archivo).
  durationS: z.coerce.number().int().positive().max(MAX_S).optional(),
});

router.post('/', requireUploadTicket, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'El archivo es muy pesado. Máximo 100 MB para videos y 10 MB para imágenes.' });
    return res.status(400).json({ error: err.message || 'No se pudo leer el archivo.' });
  });
}, async (req, res, next) => {
  let diskPath = null;
  try {
    if (!req.file) return res.status(400).json({ error: 'Elegí un archivo.' });
    const parsed = fieldsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Datos inválidos.' });
    const { publicName } = parsed.data;

    const isVideo = /\.mp4$/i.test(req.file.originalname);
    if (!isVideo && req.file.buffer.length > IMAGE_MAX) return res.status(400).json({ error: 'La imagen es muy pesada. Máximo 10 MB.' });
    const mime = detectMimeFromBuffer(req.file.buffer);
    if (!mime || mime.startsWith('video/') !== isVideo) {
      return res.status(400).json({ error: 'El archivo no es una imagen o un video MP4 válido.' });
    }

    // Tope de segundos de ESTA empresa (Maestro del panel).
    const maxS = await maxSecondsForClient(req.portal.clientId);
    let durationS;
    if (isVideo) {
      const real = mp4DurationSeconds(req.file.buffer);
      durationS = real != null ? Math.max(1, Math.ceil(real - 0.05)) : parsed.data.durationS;
      if (!durationS) return res.status(400).json({ error: 'No pudimos leer la duración del video. Exportalo como MP4 (H.264) y probá de nuevo.' });
      if (durationS > maxS) return res.status(400).json({ error: `El video dura ${durationS} s. Tu máximo es ${maxS} s.` });
    } else {
      durationS = parsed.data.durationS ?? Math.min(10, maxS);
      if (durationS > maxS) return res.status(400).json({ error: `El tiempo en pantalla máximo es ${maxS} s.` });
    }

    const buffer = isVideo ? req.file.buffer : await compressImage(req.file.buffer, mime);
    const stored = await storeAdFile(buffer, req.file.originalname, mime);
    diskPath = stored.diskPath;

    const ad = await prisma.ad.create({
      data: {
        clientId: req.portal.clientId, name: publicName, publicName, uploadedByClient: true,
        type: isVideo ? 'video' : 'image', fileUrl: stored.fileUrl, filename: stored.filename,
        fileSize: buffer.length, durationS, approvalStatus: 'pending',
      },
    });
    diskPath = null;
    await logPortalEvent('PORTAL_AD_UPLOADED', req.portal.clientUserId, `ad=${ad.id} "${publicName}" (${ad.type}, ${durationS}s)`, req.ip);
    sendAlert('portal_ad_uploaded', 'Anuncio nuevo para revisar',
      `${req.portal.clientName} subió "${publicName}" desde su portal (${isVideo ? 'video' : 'imagen'}, ${durationS} s). Está en Anuncios → pendientes de aprobación.`,
      'warning').catch(() => {});
    res.status(201).json({ id: ad.id, name: publicName, type: ad.type, durationS, status: 'revision', createdAt: ad.createdAt });
  } catch (err) {
    if (diskPath) fs.unlink(diskPath, () => {});
    next(err);
  }
});

module.exports = router;
module.exports.MAX_PENDING_UPLOADS = MAX_PENDING_UPLOADS;
