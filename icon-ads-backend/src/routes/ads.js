const router = require('express').Router();
const { z } = require('zod');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const prisma = require('../lib/prisma');
const r2 = require('../lib/r2');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../lib/auditLog');
const { bumpPlaylistsForAdIds } = require('../lib/bumpPlaylists');

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const ALLOWED_EXT = /\.(mp4|jpg|jpeg|png|webp)$/i;
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (ALLOWED_EXT.test(file.originalname)) cb(null, true);
    else cb(new Error('Tipo de archivo no permitido. Aceptados: mp4, jpg, png, webp'));
  },
  limits: { fileSize: 100 * 1024 * 1024 },
});

router.use(requireAuth);

const adSchema = z.object({
  campaignId: z.coerce.number().int().positive(),
  name: z.string().min(1),
  type: z.enum(['video', 'image']),
  durationS: z.coerce.number().int().positive(),
});

router.get('/', async (req, res, next) => {
  try {
    const ads = await prisma.ad.findMany({
      where: { deletedAt: null },
      include: { campaign: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(ads);
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/storage — storage usage from uploads dir (#28)
router.get('/storage-stats', async (req, res, next) => {
  try {
    let totalBytes = 0;
    let fileCount = 0;
    if (fs.existsSync(uploadDir)) {
      const files = fs.readdirSync(uploadDir);
      fileCount = files.length;
      for (const f of files) {
        try { totalBytes += fs.statSync(path.join(uploadDir, f)).size; } catch { /* skip */ }
      }
    }
    const adCount = await prisma.ad.count({ where: { deletedAt: null, active: true } });
    res.json({ totalBytes, totalMB: Math.round(totalBytes / 1024 / 1024), fileCount, adCount });
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
    const { key, publicUrl, campaignId, name, type, durationS } = adSchema.extend({
      key: z.string().min(1),
      publicUrl: z.string().url(),
    }).parse(req.body);
    const filename = path.basename(key);
    const approvalStatus = req.user?.role === 'superadmin' ? 'approved' : 'pending';
    const ad = await prisma.ad.create({
      data: { campaignId, name, type, fileUrl: publicUrl, filename, durationS, approvalStatus },
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
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { campaignId, name, type, durationS } = adSchema.parse(req.body);
    const fileUrl = `/uploads/${req.file.filename}`;
    // Approval: superadmin → approved immediately; admin → pending (#26)
    const approvalStatus = req.user?.role === 'superadmin' ? 'approved' : 'pending';
    const ad = await prisma.ad.create({
      data: { campaignId, name, type, fileUrl, filename: req.file.filename, durationS, approvalStatus },
      include: { campaign: { select: { id: true, name: true } } },
    });
    await audit(req, 'UPLOAD', 'ad', ad.id, `Uploaded "${ad.name}" (${approvalStatus})`);
    res.status(201).json(ad);
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
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

module.exports = router;
