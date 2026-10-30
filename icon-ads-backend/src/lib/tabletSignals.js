// Aviso inmediato a las tablets (push FCM) cuando cambia lo que pueden pasar.
//
// Sin esto, una tablet se entera en su próximo sync (minutos). Con el push:
//  - las tablets que tienen alguno de esos anuncios en su playlist sincronizan
//    ya (las APK viejas también: es el mismo 'force_sync' de siempre);
//  - si el anuncio dejó de poder pasar (pausado, rechazado, borrado, empresa
//    pausada/desactivada, terminó su fecha), el push lleva stopAdIds y la APK
//    >= 1.52 lo corta al instante aunque esté en pantalla. Si no lo tiene, no
//    pasa nada.
//
// Siempre en segundo plano: nunca se espera desde una respuesta HTTP (FCM
// desde Render a veces tarda segundos; ver lib/firebase-admin.js).

const prisma = require('./prisma');
const firebaseAdmin = require('./firebase-admin');
const { isAdPlayable } = require('./adSchedule');

const CLIENT_STATE = { select: { active: true, deletedAt: true } };

async function signalAdsChanged(adIds) {
  if (!adIds?.length || !firebaseAdmin.isConfigured) return;
  const [links, ads] = await Promise.all([
    prisma.playlistAd.findMany({ where: { adId: { in: adIds } }, select: { playlistId: true }, distinct: ['playlistId'] }),
    prisma.ad.findMany({
      where: { id: { in: adIds } },
      select: { id: true, active: true, deletedAt: true, approvalStatus: true, startsAt: true, endsAt: true, client: CLIENT_STATE },
    }),
  ]);
  if (!links.length) return;
  const tablets = await prisma.tablet.findMany({
    where: { playlistId: { in: links.map((l) => l.playlistId) }, fcmToken: { not: null } },
    select: { fcmToken: true },
  });
  if (!tablets.length) return;
  const now = new Date();
  const stopAdIds = ads.filter((a) => !isAdPlayable(a, now)).map((a) => a.id);
  const data = { type: 'force_sync' };
  if (stopAdIds.length) data.stopAdIds = stopAdIds.join(',');
  const r = await firebaseAdmin.sendDataPush(tablets.map((t) => t.fcmToken), data);
  console.log(`[tabletSignals] ads=[${adIds.join(',')}] stop=[${stopAdIds.join(',')}] → ${tablets.length} tablet(s), ok=${r.successCount ?? 0}`);
}

// Una playlist pausada / reanudada: que sus tablets sincronicen ya.
async function signalPlaylistChanged(playlistId) {
  if (!firebaseAdmin.isConfigured) return;
  const tablets = await prisma.tablet.findMany({ where: { playlistId, fcmToken: { not: null } }, select: { fcmToken: true } });
  if (tablets.length) await firebaseAdmin.sendSyncPush(tablets.map((t) => t.fcmToken));
}

const background = (p) => { p.catch((err) => console.warn('[tabletSignals]', err.message)); };

module.exports = {
  signalAdsChanged: (adIds) => background(signalAdsChanged(adIds)),
  signalPlaylistChanged: (id) => background(signalPlaylistChanged(id)),
};
