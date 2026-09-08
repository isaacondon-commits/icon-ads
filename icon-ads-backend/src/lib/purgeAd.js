const prisma = require('./prisma');
const r2 = require('./r2');

// Borra un anuncio DEFINITIVAMENTE: sus filas PlaylistAd y Metric (FK Restrict),
// la fila Ad, y los archivos en R2 (best-effort). NO valida deletedAt — el caller
// decide. Devuelve el ad borrado (para el audit) o null si no existía.
async function purgeAd(adId) {
  const ad = await prisma.ad.findUnique({ where: { id: adId } });
  if (!ad) return null;

  await prisma.metric.deleteMany({ where: { adId } });
  await prisma.playlistAd.deleteMany({ where: { adId } });
  await prisma.ad.delete({ where: { id: adId } });

  const base = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  for (const url of [ad.fileUrl, ad.thumbnailUrl]) {
    if (url && base && url.startsWith(`${base}/`)) {
      await r2.deleteObject(url.slice(base.length + 1)).catch(() => {});
    }
  }
  return ad;
}

module.exports = { purgeAd };
