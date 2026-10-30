const prisma = require('./prisma');

// Bump version + clear cache for all playlists containing any of the given ad IDs.
// This signals tablets to re-download on next sync. Además les avisa ya por push
// (lib/tabletSignals.js): si algún anuncio dejó de poder pasar, lo cortan al instante.
async function bumpPlaylistsForAdIds(adIds) {
  if (!adIds.length) return;
  const affected = await prisma.playlistAd.findMany({
    where: { adId: { in: adIds } },
    select: { playlistId: true },
    distinct: ['playlistId'],
  });
  const playlistIds = affected.map((r) => r.playlistId);
  if (!playlistIds.length) return;
  await prisma.playlist.updateMany({
    where: { id: { in: playlistIds } },
    data: { version: { increment: 1 }, contentHash: null },
  });
  console.log(`[bumpPlaylists] bumped ${playlistIds.length} playlist(s) — adIds=[${adIds.join(',')}]`);
  // require diferido: tabletSignals usa adSchedule, que usa este módulo.
  require('./tabletSignals').signalAdsChanged(adIds);
}

module.exports = { bumpPlaylistsForAdIds };
