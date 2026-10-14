// Diagnóstico de entrega de cada anuncio para el panel: cuántas veces se
// reprodujo, en qué playlists está, a cuántas tablets llega, y — si no puede
// pasar — el motivo concreto ("sin campaña", "campaña vencida", "no está en
// ninguna playlist", etc.).

const prisma = require('./prisma');
const { isCampaignExpired } = require('./campaignSchedule');

// Primer motivo que impide que el anuncio salga en pantalla, o null si está
// en condiciones de reproducirse. `level`: 'error' = no va a pasar nunca así
// como está; 'info' = es esperado (pendiente, pausado, programado).
function blockingIssue(ad, playlists, now) {
  const c = ad.campaign;
  if (!c || c.deletedAt) return { code: 'no_campaign', level: 'error', label: c ? `Sin campaña (la campaña "${c.name}" está archivada)` : 'Sin campaña' };
  if (ad.approvalStatus === 'pending') return { code: 'pending', level: 'info', label: 'Pendiente de aprobación' };
  if (ad.approvalStatus === 'rejected') return { code: 'rejected', level: 'info', label: 'Rechazado' };
  if (!ad.active) return { code: 'paused', level: 'info', label: 'Anuncio pausado' };
  if (ad.startsAt && new Date(ad.startsAt) > now) return { code: 'ad_scheduled', level: 'info', label: 'Todavía no empieza (fecha del anuncio)' };
  if (ad.endsAt && new Date(ad.endsAt) < now) return { code: 'ad_ended', level: 'error', label: 'Terminó su fecha de publicación' };
  if (isCampaignExpired(c, now)) return { code: 'campaign_expired', level: 'error', label: 'La campaña está vencida' };
  if (!c.active) return { code: 'campaign_paused', level: 'info', label: 'La campaña está pausada' };
  if (new Date(c.startDate) > now) return { code: 'campaign_scheduled', level: 'info', label: 'La campaña todavía no empieza' };
  if (!playlists.length) return { code: 'no_playlist', level: 'error', label: 'No está en ninguna playlist' };
  if (!playlists.some((p) => p.tablets > 0)) return { code: 'no_tablets', level: 'error', label: 'Su playlist no está asignada a ninguna tablet' };
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
      select: { adId: true, playlist: { select: { id: true, name: true } } },
    }),
    prisma.tablet.groupBy({ by: ['playlistId'], where: { playlistId: { not: null } }, _count: { _all: true } }),
  ]);
  const playMap = Object.fromEntries(plays.map((p) => [p.adId, p]));
  const tabletsByPlaylist = Object.fromEntries(tabletCounts.map((t) => [t.playlistId, t._count._all]));
  const playlistsByAd = {};
  for (const l of links) {
    const list = (playlistsByAd[l.adId] ||= []);
    if (!list.some((p) => p.id === l.playlist.id)) {
      list.push({ id: l.playlist.id, name: l.playlist.name, tablets: tabletsByPlaylist[l.playlist.id] ?? 0 });
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
      tablets: playlists.reduce((n, pl) => n + pl.tablets, 0),
      issue: blockingIssue(ad, playlists, now),
    }];
  }));
}

module.exports = { adDeliveryInfo, blockingIssue };
