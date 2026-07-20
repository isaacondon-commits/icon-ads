const router = require('express').Router();
const { z } = require('zod');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const prisma = require('../lib/prisma');
const r2 = require('../lib/r2');
const supabaseStorage = require('../lib/supabase-storage');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../lib/auditLog');
const { bumpPlaylistsForAdIds } = require('../lib/bumpPlaylists');

const IMAGE_MAX = 10 * 1024 * 1024;
const VIDEO_MAX = 100 * 1024 * 1024;

function detectMimeFromBuffer(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'video/mp4';
  return null;
}

async function compressImage(buffer, mimetype) {
  try {
    const s = sharp(buffer).resize(1920, 1080, { fit: 'inside', withoutEnlargement: true });
    if (mimetype === 'image/png') return await s.png({ quality: 80 }).toBuffer();
    if (mimetype === 'image/webp') return await s.webp({ quality: 80 }).toBuffer();
    return await s.jpeg({ quality: 80 }).toBuffer();
  } catch {
    return buffer;
  }
}

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_EXT = /\.(mp4|jpg|jpeg|png|webp)$/i;
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (ALLOWED_EXT.test(file.originalname)) cb(null, true);
    else cb(new Error('Tipo de archivo no permitido. Aceptados: mp4, jpg, png, webp'));
  },
  limits: { fileSize: 100 * 1024 * 1024 },
});

router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid id' });
  next();
});

const parseTags = (v) => {
  if (!v || v === '') return [];
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
};

const adSchema = z.object({
  campaignId: z.coerce.number().int().positive(),
  name: z.string().min(1),
  type: z.enum(['video', 'image']),
  durationS: z.coerce.number().int().positive(),
  priority: z.coerce.number().int().min(0).optional(),
  targetUrl: z.preprocess((v) => (!v || v === '' ? null : v), z.string().url().nullable().optional()),
  startsAt: z.preprocess((v) => (!v || v === '' ? null : v), z.string().datetime().nullable().optional()),
  endsAt: z.preprocess((v) => (!v || v === '' ? null : v), z.string().datetime().nullable().optional()),
  tags: z.preprocess(parseTags, z.array(z.string()).optional()),
});

// GET /archived — soft-deleted ads (#5)
router.get('/archived', async (req, res, next) => {
  try {
    const ads = await prisma.ad.findMany({
      where: { NOT: { deletedAt: null } },
      include: { campaign: { select: { id: true, name: true, clientId: true, client: { select: { name: true } } } } },
      orderBy: { deletedAt: 'desc' },
    });
    res.json(ads);
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const tag = req.query.tag ? String(req.query.tag) : undefined;
    const ads = await prisma.ad.findMany({
      where: { deletedAt: null, ...(tag ? { tags: { has: tag } } : {}) },
      include: { campaign: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(ads);
  } catch (err) {
    next(err);
  }
});

// GET /api/ads/storage-stats — storage usage
router.get('/storage-stats', async (req, res, next) => {
  try {
    const adCount = await prisma.ad.count({ where: { deletedAt: null, active: true } });
    if (supabaseStorage.isConfigured) {
      return res.json({ totalBytes: 0, totalMB: 0, fileCount: adCount, adCount, storage: 'supabase' });
    }
    let totalBytes = 0;
    let fileCount = 0;
    if (fs.existsSync(uploadDir)) {
      const files = fs.readdirSync(uploadDir);
      fileCount = files.length;
      for (const f of files) {
        try { totalBytes += fs.statSync(path.join(uploadDir, f)).size; } catch { /* skip */ }
      }
    }
    res.json({ totalBytes, totalMB: Math.round(totalBytes / 1024 / 1024), fileCount, adCount, storage: 'disk' });
  } catch (err) {
    next(err);
  }
});

// GET /api/ads/presign — returns a presigned R2 upload URL (requires R2 configured)
router.get('/presign', async (req, res, next) => {
  try {
    if (!r2.isConfigured) return res.status(503).json({ error: 'R2 not configured' });
    const { filename, contentType } = req.query;
    if (!filename || !contentType) return res.status(400).json({ error: 'filename and contentType required' });
    if (!ALLOWED_EXT.test(filename)) return res.status(400).json({ error: 'Tipo de archivo no permitido' });
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(filename);
    const key = `uploads/${unique}${ext}`;
    const uploadUrl = await r2.getPresignedUploadUrl(key, contentType);
    const publicUrl = r2.getPublicUrl(key);
    res.json({ uploadUrl, key, publicUrl });
  } catch (err) {
    next(err);
  }
});

// POST /api/ads/confirm — registers an ad after direct R2 upload
router.post('/confirm', async (req, res, next) => {
  try {
    if (!r2.isConfigured) return res.status(503).json({ error: 'R2 not configured' });
    const { key, publicUrl, campaignId, name, type, durationS, priority, targetUrl, startsAt, endsAt, tags } = adSchema.extend({
      key: z.string().min(1),
      publicUrl: z.string().url(),
    }).parse(req.body);
    const filename = path.basename(key);
    const approvalStatus = req.user?.role === 'superadmin' ? 'approved' : 'pending';
    const ad = await prisma.ad.create({
      data: { campaignId, name, type, fileUrl: publicUrl, filename, durationS, approvalStatus,
              priority: priority ?? 0, targetUrl: targetUrl ?? null, tags: tags ?? [],
              startsAt: startsAt ? new Date(startsAt) : null, endsAt: endsAt ? new Date(endsAt) : null },
      include: { campaign: { select: { id: true, name: true } } },
    });
    await audit(req, 'UPLOAD', 'ad', ad.id, `Uploaded "${ad.name}" via R2 (${approvalStatus})`);
    res.status(201).json(ad);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// POST /api/ads/upload — must be before /:id routes
router.post('/upload', upload.single('file'), async (req, res, next) => {
  let diskPath = null;
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const isVideo = /\.(mp4)$/i.test(req.file.originalname);
    const maxSize = isVideo ? VIDEO_MAX : IMAGE_MAX;
    if (req.file.buffer.length > maxSize) {
      return res.status(400).json({ error: `Tamaño máximo: ${isVideo ? '100MB para videos' : '10MB para imágenes'}` });
    }
    const detectedMime = detectMimeFromBuffer(req.file.buffer);
    if (!detectedMime) {
      return res.status(400).json({ error: 'El archivo no es una imagen o video válido (firma inválida)' });
    }

    const { campaignId, name, type, durationS, priority, targetUrl, startsAt, endsAt, tags } = adSchema.parse(req.body);

    let fileBuffer = req.file.buffer;
    if (!isVideo) fileBuffer = await compressImage(fileBuffer, req.file.mimetype);

    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(req.file.originalname);
    const filename = `${unique}${ext}`;

    let fileUrl;
    if (supabaseStorage.isConfigured) {
      fileUrl = await supabaseStorage.uploadFile(filename, fileBuffer, req.file.mimetype);
    } else {
      diskPath = path.join(uploadDir, filename);
      fs.writeFileSync(diskPath, fileBuffer);
      fileUrl = `/uploads/${filename}`;
    }

    // Approval: superadmin → approved immediately; admin → pending (#26)
    const approvalStatus = req.user?.role === 'superadmin' ? 'approved' : 'pending';
    const ad = await prisma.ad.create({
      data: { campaignId, name, type, fileUrl, filename, durationS, approvalStatus,
              priority: priority ?? 0, targetUrl: targetUrl ?? null, tags: tags ?? [],
              startsAt: startsAt ? new Date(startsAt) : null, endsAt: endsAt ? new Date(endsAt) : null },
      include: { campaign: { select: { id: true, name: true } } },
    });
    await audit(req, 'UPLOAD', 'ad', ad.id, `Uploaded "${ad.name}" (${approvalStatus}) via ${supabaseStorage.isConfigured ? 'supabase' : 'disk'}`);
    res.status(201).json(ad);
  } catch (err) {
    if (diskPath) fs.unlink(diskPath, () => {});
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

router.get('/pending-count', async (req, res, next) => {
  try {
    const count = await prisma.ad.count({ where: { approvalStatus: 'pending', deletedAt: null } });
    res.json({ count });
  } catch (err) {
    next(err);
  }
});

// GET /tags — all unique tags across active ads (#16)
router.get('/tags', async (req, res, next) => {
  try {
    const ads = await prisma.ad.findMany({ where: { deletedAt: null }, select: { tags: true } });
    const all = new Set(ads.flatMap((a) => a.tags));
    res.json([...all].sort());
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const ad = await prisma.ad.findUnique({
      where: { id: Number(req.params.id), deletedAt: null },
      include: { campaign: { select: { id: true, name: true } } },
    });
    if (!ad) return res.status(404).json({ error: 'Ad not found' });
    res.json(ad);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const data = adSchema.omit({ campaignId: true }).partial().parse(req.body);
    const ad = await prisma.ad.update({ where: { id: Number(req.params.id), deletedAt: null }, data });
    await audit(req, 'UPDATE', 'ad', ad.id, `Updated "${ad.name}"`);
    res.json(ad);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Ad not found' });
    next(err);
  }
});

// DELETE — soft delete (#33)
router.delete('/:id', async (req, res, next) => {
  try {
    const ad = await prisma.ad.update({
      where: { id: Number(req.params.id), deletedAt: null },
      data: { active: false, deletedAt: new Date() },
    });
    await audit(req, 'DELETE', 'ad', ad.id, `Deleted "${ad.name}"`);
    await bumpPlaylistsForAdIds([ad.id]);
    res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Ad not found' });
    next(err);
  }
});

// PATCH /:id/approve — approve pending ad (#26)
router.patch('/:id/approve', async (req, res, next) => {
  try {
    const ad = await prisma.ad.update({ where: { id: Number(req.params.id) }, data: { approvalStatus: 'approved', active: true } });
    await audit(req, 'APPROVE', 'ad', ad.id, `Approved "${ad.name}"`);
    await bumpPlaylistsForAdIds([ad.id]);
    res.json(ad);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Ad not found' });
    next(err);
  }
});

// PATCH /:id/reject — reject pending ad (#26)
router.patch('/:id/reject', async (req, res, next) => {
  try {
    const ad = await prisma.ad.update({ where: { id: Number(req.params.id) }, data: { approvalStatus: 'rejected', active: false } });
    await audit(req, 'REJECT', 'ad', ad.id, `Rejected "${ad.name}"`);
    await bumpPlaylistsForAdIds([ad.id]);
    res.json(ad);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Ad not found' });
    next(err);
  }
});

// PATCH /:id/restore — restore soft-deleted ad (#5)
router.patch('/:id/restore', async (req, res, next) => {
  try {
    const ad = await prisma.ad.update({
      where: { id: Number(req.params.id) },
      data: { active: true, deletedAt: null, approvalStatus: 'approved' },
    });
    await audit(req, 'RESTORE', 'ad', ad.id, `Restored "${ad.name}"`);
    await bumpPlaylistsForAdIds([ad.id]);
    res.json(ad);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Ad not found' });
    next(err);
  }
});

module.exports = router;
