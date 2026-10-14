// Ventana de vigencia de campañas y anuncios: qué se puede reproducir AHORA.
//
// El panel guarda las fechas de campaña como medianoche local del día elegido
// (fecha fin "20/10" => 2026-10-20T03:00Z). El día de fin es INCLUSIVE: la
// campaña corre hasta el final de ese día, o sea hasta endDate + 24 h.
//
// Una campaña vencida NO se reproduce (se filtra al armar el paquete) y además
// se desactiva sola (active=false) con checkCampaignSchedule(), que corre cada
// 5 min: sube la versión de las playlists afectadas para que las tablets
// re-descarguen el paquete sin esos anuncios, y deja una alerta en la campanita.

const prisma = require('./prisma');
const { bumpPlaylistsForAdIds } = require('./bumpPlaylists');
const { sendAlert } = require('./alerts');
const syslog = require('./systemLog');

const DAY_MS = 24 * 60 * 60 * 1000;

/** Instante en que la campaña deja de estar vigente (fin del día de endDate). */
function campaignEndsAt(campaign) {
  return new Date(new Date(campaign.endDate).getTime() + DAY_MS);
}

function isCampaignExpired(campaign, now = new Date()) {
  return campaignEndsAt(campaign) <= now;
}

/** Campaña en condiciones de reproducirse: activa, no archivada, dentro de fechas. */
function isCampaignLive(campaign, now = new Date()) {
  return !!campaign
    && campaign.active
    && !campaign.deletedAt
    && new Date(campaign.startDate) <= now
    && !isCampaignExpired(campaign, now);
}

/** Anuncio reproducible: aprobado, activo, dentro de su ventana y de la de su campaña. */
function isAdPlayable(ad, now = new Date()) {
  return ad.active
    && !ad.deletedAt
    && ad.approvalStatus === 'approved'
    && (!ad.startsAt || new Date(ad.startsAt) <= now)
    && (!ad.endsAt || new Date(ad.endsAt) >= now)
    && isCampaignLive(ad.campaign, now);
}

// Último chequeo, persistido para no perder transiciones (inicio de campaña,
// fin de anuncio) que ocurran mientras el server está caído o redeployando.
const LAST_CHECK_KEY = 'campaign_schedule_checked_at';

async function checkCampaignSchedule() {
  const now = new Date();
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: LAST_CHECK_KEY } });
    const parsed = row ? new Date(row.value) : null;
    const lastCheck = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(now.getTime() - 10 * 60 * 1000);

    // 1) Campañas vencidas que siguen activas -> desactivar.
    const expired = await prisma.campaign.findMany({
      where: { active: true, deletedAt: null, endDate: { lte: new Date(now.getTime() - DAY_MS) } },
      include: { client: { select: { name: true } }, ads: { select: { id: true } } },
    });
    if (expired.length) {
      await prisma.campaign.updateMany({ where: { id: { in: expired.map((c) => c.id) } }, data: { active: false } });
      const names = expired.map((c) => `"${c.name}" (${c.client?.name ?? 'sin cliente'})`).join(', ');
      syslog.addEvent('CAMPAIGN_EXPIRED', 'campaign', null, `${expired.length} campaña(s) vencida(s) desactivada(s): ${names}`);
      sendAlert('campaign_expired',
        expired.length === 1 ? `Campaña vencida: ${expired[0].name}` : `${expired.length} campañas vencidas`,
        `Se desactivaron y dejaron de reproducirse: ${names}. Para volver a pasarlas, extendé la fecha de fin y reanudalas.`,
        'warning').catch(() => {});
    }

    // 2) Transiciones que cambian el contenido de las playlists desde el último
    //    chequeo: campañas que empezaron y anuncios que entraron/salieron de su
    //    ventana. Más los anuncios de las campañas recién vencidas.
    const [started, adWindows] = await Promise.all([
      prisma.campaign.findMany({
        where: { active: true, deletedAt: null, startDate: { gt: lastCheck, lte: now } },
        select: { ads: { select: { id: true } } },
      }),
      prisma.ad.findMany({
        where: {
          deletedAt: null,
          OR: [
            { startsAt: { gt: lastCheck, lte: now } },
            { endsAt: { gt: lastCheck, lte: now } },
          ],
        },
        select: { id: true },
      }),
    ]);
    const adIds = new Set();
    for (const c of [...expired, ...started]) for (const a of c.ads) adIds.add(a.id);
    for (const a of adWindows) adIds.add(a.id);
    if (adIds.size) await bumpPlaylistsForAdIds([...adIds]);

    await prisma.systemConfig.upsert({
      where: { key: LAST_CHECK_KEY },
      update: { value: now.toISOString() },
      create: { key: LAST_CHECK_KEY, value: now.toISOString() },
    });
    return { expired: expired.length, bumpedAds: adIds.size };
  } catch (err) {
    console.warn('[campaign-schedule]', err.message);
    return { error: err.message };
  }
}

module.exports = { campaignEndsAt, isCampaignExpired, isCampaignLive, isAdPlayable, checkCampaignSchedule };
