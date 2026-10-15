const prisma = require('./prisma');
const syslog = require('./systemLog');

// Avisa por los canales configurados: log del sistema + webhook (webhook_url)
// + WhatsApp vía CallMeBot (callmebot_phone / callmebot_apikey). Nunca tira:
// un canal caído no frena a quien avisa.
async function notifyChannels(title, body, opts = {}) {
  const eventType = opts.eventType || 'TABLET_NOT_PLAYING';
  const webhookEvent = opts.webhookEvent || 'tablet_not_playing';
  syslog.addEvent(eventType, 'tablet', null, body);
  try {
    const cfg = await prisma.systemConfig.findUnique({ where: { key: 'webhook_url' } });
    if (cfg?.value) {
      fetch(cfg.value, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: webhookEvent, message: body }) })
        .catch((e) => console.warn('[webhook]', e.message));
    }
  } catch { /* non-fatal */ }
  try {
    const [phoneCfg, apikeyCfg] = await Promise.all([
      prisma.systemConfig.findUnique({ where: { key: 'callmebot_phone' } }),
      prisma.systemConfig.findUnique({ where: { key: 'callmebot_apikey' } }),
    ]);
    if (phoneCfg?.value && apikeyCfg?.value) {
      fetch(`https://api.callmebot.com/whatsapp.php?phone=${phoneCfg.value}&text=${encodeURIComponent(`ICON ADS: ${body}`)}&apikey=${apikeyCfg.value}`)
        .catch((e) => console.warn('[callmebot]', e.message));
    }
  } catch { /* non-fatal */ }
}

module.exports = notifyChannels;
