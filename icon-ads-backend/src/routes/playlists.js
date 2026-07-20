const router = require('express').Router();
const { z } = require('zod');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../lib/auditLog');

router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid id' });
  next();
});

const playlistSchema = z.object({ name: z.string().min(1) });
const playlistAdsSchema = z.array(z.object({ adId: z.number().int().positive(), order: z.number().int().min(0) }));

router.get('/', async (req, res, next) => {
  try {
    const playlists = await prisma.playlist.findMany({
      include: {
        playlistAds: { include: { ad: true }, orderBy: { order: 'asc' } },
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
    await audit(req, 'CREATE', 'playlist', playlist.id, `Created "${playlist.name}"`);
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
    const playlist = await prisma.playlist.update({ where: { id: Number(req.params.id) }, data });
    res.json(playlist);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Playlist not found' });
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const playlist = await prisma.playlist.findUnique({ where: { id } });
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    // Clear FK references that don't cascade automatically
    await prisma.tablet.updateMany({ where: { playlistId: id }, data: { playlistId: null } });
    await prisma.playlistAd.deleteMany({ where: { playlistId: id } });
    await prisma.playlist.delete({ where: { id } });
    await audit(req, 'DELETE', 'playlist', id, `Deleted "${playlist.name}"`);
    res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Playlist not found' });
    next(err);
  }
});

// POST /:id/ads — replace ads + bump version + save version snapshot (#17)
router.post('/:id/ads', async (req, res, next) => {
  try {
    const ads = playlistAdsSchema.parse(req.body);
    const playlistId = Number(req.params.id);

    const playlist = await prisma.$transaction(async (tx) => {
      await tx.playlistAd.deleteMany({ where: { playlistId } });
      if (ads.length > 0) {
        await tx.playlistAd.createMany({ data: ads.map(({ adId, order }) => ({ playlistId, adId, order })) });
      }
      const updated = await tx.playlist.update({
        where: { id: playlistId },
        data: { version: { increment: 1 } },
        include: { playlistAds: { include: { ad: true }, orderBy: { order: 'asc' } } },
      });
      // Save version snapshot
      await tx.playlistVersion.create({
        data: {
          playlistId,
          version: updated.version,
          snapshot: { name: updated.name, ads: ads },
        },
      });
      return updated;
    });

    await audit(req, 'UPDATE_ADS', 'playlist', playlistId, `Updated ads on "${playlist.name}" (v${playlist.version})`);
    res.json(playlist);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Playlist not found' });
    next(err);
  }
});

// GET /:id/versions — list version history (#17)
router.get('/:id/versions', async (req, res, next) => {
  try {
    const versions = await prisma.playlistVersion.findMany({
      where: { playlistId: Number(req.params.id) },
      orderBy: { version: 'desc' },
    });
    res.json(versions);
  } catch (err) {
    next(err);
  }
});

// POST /:id/revert/:version — revert to a previous version (#17)
router.post('/:id/revert/:version', async (req, res, next) => {
  try {
    const playlistId = Number(req.params.id);
    const targetVersion = Number(req.params.version);
    const versionRecord = await prisma.playlistVersion.findFirst({
      where: { playlistId, version: targetVersion },
    });
    if (!versionRecord) return res.status(404).json({ error: 'Version not found' });

    const snapshot = versionRecord.snapshot;
    const ads = snapshot.ads ?? [];

    const playlist = await prisma.$transaction(async (tx) => {
      await tx.playlistAd.deleteMany({ where: { playlistId } });
      if (ads.length > 0) {
        await tx.playlistAd.createMany({ data: ads.map(({ adId, order }) => ({ playlistId, adId, order })) });
      }
      const updated = await tx.playlist.update({
        where: { id: playlistId },
        data: { version: { increment: 1 } },
        include: { playlistAds: { include: { ad: true }, orderBy: { order: 'asc' } } },
      });
      await tx.playlistVersion.create({
        data: { playlistId, version: updated.version, snapshot: { name: updated.name, ads, revertedFrom: targetVersion } },
      });
      return updated;
    });
    await audit(req, 'REVERT', 'playlist', playlistId, `Reverted "${playlist.name}" to v${targetVersion}`);
    res.json(playlist);
  } catch (err) {
    next(err);
  }
});

// POST /:id/duplicate (#14)
router.post('/:id/duplicate', async (req, res, next) => {
  try {
    const source = await prisma.playlist.findUnique({
      where: { id: Number(req.params.id) },
      include: { playlistAds: true },
    });
    if (!source) return res.status(404).json({ error: 'Playlist not found' });
    const copy = await prisma.$transaction(async (tx) => {
      const newPlaylist = await tx.playlist.create({ data: { name: `${source.name} (copia)` } });
      if (source.playlistAds.length > 0) {
        await tx.playlistAd.createMany({
          data: source.playlistAds.map((pa) => ({ playlistId: newPlaylist.id, adId: pa.adId, order: pa.order })),
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
