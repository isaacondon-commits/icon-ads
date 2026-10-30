// Ventana de vigencia de los anuncios: qué se puede reproducir AHORA.
//
// Cada anuncio puede tener fecha de inicio (startsAt) y de fin (endsAt). Fuera
// de esa ventana no entra al paquete. checkAdSchedule() corre cada 5 min y,
// cuando un anuncio entra o sale de su ventana, sube la versión de las
// playlists que lo tienen para que las tablets re-descarguen el paquete.

const prisma = require('./prisma');
const { bumpPlaylistsForAdIds } = require('./bumpPlaylists');

/** Anuncio reproducible: aprobado, activo, no archivado y dentro de su ventana. */
function isAdPlayable(ad, now = new Date()) {
  return ad.active
    && !ad.deletedAt
    && ad.approvalStatus === 'approved'
    && (!ad.startsAt || new Date(ad.startsAt) <= now)
    && (!ad.endsAt || new Date(ad.endsAt) >= now);
}

// Último chequeo, persistido para no perder transiciones (inicio o fin de un
// anuncio) que ocurran mientras el server está caído o redeployando.
const LAST_CHECK_KEY = 'ad_schedule_checked_at';

async function checkAdSchedule() {
  const now = new Date();
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: LAST_CHECK_KEY } });
    const parsed = row ? new Date(row.value) : null;
    const lastCheck = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(now.getTime() - 10 * 60 * 1000);

    const crossed = await prisma.ad.findMany({
      where: {
        deletedAt: null,
        OR: [
          { startsAt: { gt: lastCheck, lte: now } },
          { endsAt: { gt: lastCheck, lte: now } },
        ],
      },
      select: { id: true },
    });
    if (crossed.length) await bumpPlaylistsForAdIds(crossed.map((a) => a.id));

    await prisma.systemConfig.upsert({
      where: { key: LAST_CHECK_KEY },
      update: { value: now.toISOString() },
      create: { key: LAST_CHECK_KEY, value: now.toISOString() },
    });
    return { bumpedAds: crossed.length };
  } catch (err) {
    console.warn('[ad-schedule]', err.message);
    return { error: err.message };
  }
}

module.exports = { isAdPlayable, checkAdSchedule };
