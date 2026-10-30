// Diagnóstico de entrega de cada anuncio para el panel: cuántas veces se
// reprodujo, en qué playlists está, a cuántas tablets llega, y — si no puede
// pasar — el motivo concreto ("sin empresa", "terminó su fecha", "no está en
// ninguna playlist", etc.).

const prisma = require('./prisma');

// Primer motivo que impide que el anuncio salga en pantalla, o null si está
// en condiciones de reproducirse. `level`: 'error' = no va a pasar nunca así
// como está; 'info' = es esperado (pendiente, pausado, programado).
function blockingIssue(ad, playlists, now) {
  if (!ad.clientId) return { code: 'no_client', level: 'error', label: 'Sin empresa asignada' };
  if (ad.client?.deletedAt) return { code: 'client_off', level: 'error', label: 'La empresa está desactivada' };
  if (ad.client && ad.client.active === false) return { code: 'client_paused', level: 'info', label: 'La empresa está pausada' };
  if (ad.approvalStatus === 'pending') return { code: 'pending', level: 'info', label: 'Pendiente de aprobación' };
  if (ad.approvalStatus === 'rejected') return { code: 'rejected', level: 'info', label: 'Rechazado' };
  if (!ad.active) return { code: 'paused', level: 'info', label: 'Anuncio pausado' };
  if (ad.startsAt && new Date(ad.startsAt) > now) return { code: 'ad_scheduled', level: 'info', label: 'Todavía no empieza (fecha del anuncio)' };
  if (ad.endsAt && new Date(ad.endsAt) < now) return { code: 'ad_ended', level: 'error', label: 'Terminó su fecha de publicación' };
  if (!playlists.length) return { code: 'no_playlist', level: 'error', label: 'No está en ninguna playlist' };
  if (!playlists.some((p) => p.active)) return { code: 'playlist_paused', level: 'info', label: 'Su playlist está pausada' };
  if (!playlists.some((p) => p.active && p.tablets > 0)) return { code: 'no_tablets', level: 'error', label: 'Su playlist no está asignada a ninguna tablet' };
  return null;
}

async function adDeliveryInfo(ads) {
  const ids = ads.map((a) => a.id);
  if (!ids.length) return {};
  const [plays, links, tabletCounts] = await Promise.all([
    prisma.metric.groupBy({
      by: ['adId'],
      where: { adId: { in: ids } },
      _count: { _all: true },
      _max: { playedAt: true },
    }),
    prisma.playlistAd.findMany({
      where: { adId: { in: ids } },
      select: { adId: true, playlist: { select: { id: true, name: true, active: true } } },
    }),
    prisma.tablet.groupBy({ by: ['playlistId'], where: { playlistId: { not: null } }, _count: { _all: true } }),
  ]);
  const playMap = Object.fromEntries(plays.map((p) => [p.adId, p]));
  const tabletsByPlaylist = Object.fromEntries(tabletCounts.map((t) => [t.playlistId, t._count._all]));
  const playlistsByAd = {};
  for (const l of links) {
    const list = (playlistsByAd[l.adId] ||= []);
    if (!list.some((p) => p.id === l.playlist.id)) {
      list.push({ id: l.playlist.id, name: l.playlist.name, active: l.playlist.active, tablets: tabletsByPlaylist[l.playlist.id] ?? 0 });
    }
  }
  const now = new Date();
  return Object.fromEntries(ads.map((ad) => {
    const playlists = playlistsByAd[ad.id] ?? [];
    const p = playMap[ad.id];
    return [ad.id, {
      plays: p?._count._all ?? 0,
      lastPlayedAt: p?._max.playedAt ?? null,
      playlists,
      tablets: playlists.reduce((n, pl) => n + (pl.active ? pl.tablets : 0), 0),
      issue: blockingIssue(ad, playlists, now),
    }];
  }));
}

module.exports = { adDeliveryInfo, blockingIssue };
