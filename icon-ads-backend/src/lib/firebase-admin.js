const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

const isConfigured = !!process.env.FIREBASE_SERVICE_ACCOUNT;

let app = null;
if (isConfigured) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    app = initializeApp({ credential: cert(serviceAccount) });
  } catch (err) {
    console.error('[firebase-admin] FIREBASE_SERVICE_ACCOUNT inválido:', err.message);
  }
}

// Data-only push (no `notification` field) so it's delivered silently to
// FcmService.onMessageReceived even while the app is in the foreground/kiosk mode,
// without showing a system notification.
async function sendSyncPush(tokens) {
  if (!app || tokens.length === 0) return { successCount: 0, failureCount: 0 };
  try {
    return await getMessaging(app).sendEachForMulticast({
      tokens,
      data: { type: 'force_sync' },
      android: { priority: 'high' },
    });
  } catch (err) {
    console.warn('[firebase-admin] sendSyncPush failed:', err.message);
    return { successCount: 0, failureCount: tokens.length };
  }
}

module.exports = { isConfigured, sendSyncPush };
