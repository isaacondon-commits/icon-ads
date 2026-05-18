const prisma = require('./prisma');

// Bump version + clear cache for all playlists containing any of the given ad IDs.
// This signals tablets to re-download on next sync.
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
}

async function bumpPlaylistsForCampaignId(campaignId) {
  const ads = await prisma.ad.findMany({ where: { campaignId }, select: { id: true } });
  await bumpPlaylistsForAdIds(ads.map((a) => a.id));
}

module.exports = { bumpPlaylistsForAdIds, bumpPlaylistsForCampaignId };
