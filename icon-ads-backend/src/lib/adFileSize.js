// Peso (bytes) del archivo de un anuncio, para mostrar cuánto pesa cada
// campaña. Los anuncios nuevos lo guardan al subir; los viejos se rellenan con
// un HEAD a su URL pública (R2 responde Content-Length sin mandar el archivo,
// así que no consume egress real).

const prisma = require('./prisma');

async function remoteFileSize(url, timeoutMs = 15000) {
  if (!url || !/^https?:\/\//.test(url)) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
    if (!r.ok) return null;
    const n = Number(r.headers.get('content-length'));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Rellena file_size de los anuncios que no lo tienen. De a 4 en paralelo.
async function backfillAdSizes() {
  const ads = await prisma.ad.findMany({
    where: { fileSize: null },
    select: { id: true, fileUrl: true },
  });
  if (!ads.length) return 0;
  let filled = 0;
  for (let i = 0; i < ads.length; i += 4) {
    await Promise.all(ads.slice(i, i + 4).map(async (ad) => {
      const size = await remoteFileSize(ad.fileUrl);
      if (size == null) return;
      await prisma.ad.update({ where: { id: ad.id }, data: { fileSize: size } }).catch(() => {});
      filled++;
    }));
  }
  console.log(`[ad-size] peso completado en ${filled}/${ads.length} anuncio(s) sin dato`);
  return filled;
}

module.exports = { remoteFileSize, backfillAdSizes };
