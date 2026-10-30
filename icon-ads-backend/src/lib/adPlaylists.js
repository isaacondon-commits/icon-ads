// Playlists de un anuncio, elegidas desde el propio anuncio (al crearlo o
// editarlo). Un anuncio puede estar en varias playlists y repetido dentro de
// una; las repeticiones y el orden se manejan desde la playlist. Acá sólo se
// decide "en cuáles está": si entra a una nueva, va al final; si sale, se van
// todas sus apariciones.

const prisma = require('./prisma');

/**
 * Deja al anuncio en exactamente esas playlists. Devuelve los ids de las
 * playlists que cambiaron (para subirles la versión si corresponde).
 */
async function setAdPlaylists(adId, playlistIds) {
  const wanted = [...new Set(playlistIds)];
  const current = await prisma.playlistAd.findMany({ where: { adId }, select: { playlistId: true } });
  const have = new Set(current.map((r) => r.playlistId));
  const toAdd = wanted.filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !wanted.includes(id));
  if (!toAdd.length && !toRemove.length) return [];

  const existing = await prisma.playlist.findMany({ where: { id: { in: toAdd } }, select: { id: true } });
  const valid = existing.map((p) => p.id);
  await prisma.$transaction(async (tx) => {
    if (toRemove.length) await tx.playlistAd.deleteMany({ where: { adId, playlistId: { in: toRemove } } });
    for (const playlistId of valid) {
      const last = await tx.playlistAd.aggregate({ where: { playlistId }, _max: { order: true } });
      await tx.playlistAd.create({ data: { playlistId, adId, order: (last._max.order ?? -1) + 1 } });
    }
  });
  return [...valid, ...toRemove];
}

/** Sube la versión de esas playlists para que las tablets re-descarguen. */
async function bumpPlaylists(playlistIds) {
  if (!playlistIds.length) return;
  await prisma.playlist.updateMany({
    where: { id: { in: playlistIds } },
    data: { version: { increment: 1 }, contentHash: null },
  });
}

module.exports = { setAdPlaylists, bumpPlaylists };
