const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

let app = null;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    app = initializeApp({ credential: cert(serviceAccount) });
  } catch (err) {
    console.error('[firebase-admin] FIREBASE_SERVICE_ACCOUNT inválido:', err.message);
  }
}

// True only if the app actually initialized — not just "the env var is set" —
// so callers (e.g. /api/health) can tell a malformed credential apart from a
// working one instead of reporting "configured" either way.
const isConfigured = app !== null;

// Data-only push (no `notification` field) so it's delivered silently to
// FcmService.onMessageReceived even while la app está en primer plano / kiosco,
// sin notificación del sistema. `data` values must be strings.
//
// IMPORTANTE: NUNCA usar esto en el camino crítico de una respuesta HTTP con
// await. FCM desde Render a veces tarda 5-30 s (o falla), y eso hacía que
// bloquear/prender/brillo dieran "failed to fetch". Los endpoints escriben en
// la DB y responden ya; la tablet agarra el cambio en su próximo sync igual.
// Este push sólo lo acelera. Igual le ponemos un timeout duro.
const PUSH_TIMEOUT_MS = 8000;
async function sendDataPush(tokens, data) {
  if (!app || tokens.length === 0) return { successCount: 0, failureCount: 0 };
  try {
    const send = getMessaging(app).sendEachForMulticast({ tokens, data, android: { priority: 'high' } });
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), PUSH_TIMEOUT_MS));
    return await Promise.race([send, timeout]);
  } catch (err) {
    console.warn('[firebase-admin] sendDataPush:', err.message);
    return { successCount: 0, failureCount: tokens.length };
  }
}

// Encola un sync inmediato en la tablet (SyncWorker).
const sendSyncPush = (tokens) => sendDataPush(tokens, { type: 'force_sync' });

// Despierta la pantalla y trae el player al frente aunque la tablet esté
// "apagada" (auto sin contacto): la app sigue viva en batería y el PowerController
// la reabre al recibir esto.
const sendWakePush = (tokens) => sendDataPush(tokens, { type: 'wake' });

module.exports = { isConfigured, sendSyncPush, sendWakePush, sendDataPush };
