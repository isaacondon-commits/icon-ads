// Duración máxima de los anuncios que una empresa puede subir desde el portal.
// Se configura en el panel (Maestro): un valor general (systemConfig
// portal_max_ad_seconds) y, si hace falta, uno propio por empresa
// (clients.portal_max_ad_seconds) que manda sobre el general.

const prisma = require('./prisma');

const KEY = 'portal_max_ad_seconds';
const FALLBACK_S = 120; // si nunca se configuró
const MIN_S = 5;
const MAX_S = 300;

const validSeconds = (n) => Number.isInteger(n) && n >= MIN_S && n <= MAX_S;

async function defaultMaxSeconds() {
  const row = await prisma.systemConfig.findUnique({ where: { key: KEY } });
  const n = row ? parseInt(row.value, 10) : NaN;
  return validSeconds(n) ? n : FALLBACK_S;
}

async function maxSecondsForClient(clientId) {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { portalMaxAdSeconds: true } });
  return client?.portalMaxAdSeconds ?? defaultMaxSeconds();
}

module.exports = { KEY, FALLBACK_S, MIN_S, MAX_S, validSeconds, defaultMaxSeconds, maxSecondsForClient };
