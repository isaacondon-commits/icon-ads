const router = require('express').Router();
const { z } = require('zod');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (/\.(mp4|webm|jpg|jpeg|png|gif|webp)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Invalid file type. Allowed: mp4, webm, jpg, jpeg, png, gif, webp'));
  },
  limits: { fileSize: 500 * 1024 * 1024 },
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
      include: { campaign: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(ads);
  } catch (err) {
    next(err);
  }
});

// POST /api/ads/upload — must be before /:id routes
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { campaignId, name, type, durationS } = adSchema.parse(req.body);
    const fileUrl = `/uploads/${req.file.filename}`;
    const ad = await prisma.ad.create({
      data: { campaignId, name, type, fileUrl, filename: req.file.filename, durationS },
      include: { campaign: { select: { id: true, name: true } } },
    });
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
      where: { id: Number(req.params.id) },
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
    const ad = await prisma.ad.update({
      where: { id: Number(req.params.id) },
      data,
    });
    res.json(ad);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Ad not found' });
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.ad.update({
      where: { id: Number(req.params.id) },
      data: { active: false },
    });
    res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Ad not found' });
    next(err);
  }
});

module.exports = router;
