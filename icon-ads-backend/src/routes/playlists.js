const router = require('express').Router();
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

const playlistSchema = z.object({
  name: z.string().min(1),
});

const playlistAdsSchema = z.array(
  z.object({
    adId: z.number().int().positive(),
    order: z.number().int().min(0),
  })
);

router.get('/', async (req, res, next) => {
  try {
    const playlists = await prisma.playlist.findMany({
      include: {
        playlistAds: {
          include: { ad: true },
          orderBy: { order: 'asc' },
        },
        _count: { select: { tablets: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(playlists);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const data = playlistSchema.parse(req.body);
    const playlist = await prisma.playlist.create({ data });
    res.status(201).json(playlist);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const playlist = await prisma.playlist.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        playlistAds: {
          include: { ad: { include: { campaign: { select: { id: true, name: true } } } } },
          orderBy: { order: 'asc' },
        },
      },
    });
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    res.json(playlist);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const data = playlistSchema.partial().parse(req.body);
    const playlist = await prisma.playlist.update({
      where: { id: Number(req.params.id) },
      data,
    });
    res.json(playlist);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Playlist not found' });
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.playlist.delete({ where: { id: Number(req.params.id) } });
    res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Playlist not found' });
    next(err);
  }
});

// POST /api/playlists/:id/ads — replace all ads atomically and bump version
router.post('/:id/ads', async (req, res, next) => {
  try {
    const ads = playlistAdsSchema.parse(req.body);
    const playlistId = Number(req.params.id);

    const playlist = await prisma.$transaction(async (tx) => {
      await tx.playlistAd.deleteMany({ where: { playlistId } });
      if (ads.length > 0) {
        await tx.playlistAd.createMany({
          data: ads.map(({ adId, order }) => ({ playlistId, adId, order })),
        });
      }
      return tx.playlist.update({
        where: { id: playlistId },
        data: { version: { increment: 1 } },
        include: {
          playlistAds: {
            include: { ad: true },
            orderBy: { order: 'asc' },
          },
        },
      });
    });

    res.json(playlist);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Playlist not found' });
    next(err);
  }
});

// #14 — POST /api/playlists/:id/duplicate
router.post('/:id/duplicate', async (req, res, next) => {
  try {
    const source = await prisma.playlist.findUnique({
      where: { id: Number(req.params.id) },
      include: { playlistAds: true },
    });
    if (!source) return res.status(404).json({ error: 'Playlist not found' });

    const copy = await prisma.$transaction(async (tx) => {
      const newPlaylist = await tx.playlist.create({
        data: { name: `${source.name} (copia)` },
      });
      if (source.playlistAds.length > 0) {
        await tx.playlistAd.createMany({
          data: source.playlistAds.map((pa) => ({
            playlistId: newPlaylist.id,
            adId: pa.adId,
            order: pa.order,
          })),
        });
      }
      return newPlaylist;
    });

    res.status(201).json(copy);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
