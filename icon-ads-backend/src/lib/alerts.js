// Despacho unificado de alertas: guarda en system_alerts (campanita del panel)
// + mail + webhook + WhatsApp (callmebot). Mail arranca activo si SMTP_USER y
// ALERT_EMAIL están seteados; webhook y WhatsApp se activan con su config en
// Settings (webhook_url / callmebot_phone / callmebot_apikey).

const prisma = require('./prisma');
const { sendAlertMail } = require('./mailer');

async function sendAlert(type, title, body, severity = 'warning') {
  console.log(`[alert:${severity}] ${title} — ${body}`);

  // 1) persistir para el panel (tabla creada en startup-migrate)
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO system_alerts (type, severity, title, body) VALUES ($1, $2, $3, $4)`,
      type, severity, title, body,
    );
  } catch (e) {
    console.warn('[alert] no se pudo guardar en system_alerts:', e.message);
  }

  // 2) mail (no bloquea)
  sendAlertMail(title, body).catch(() => {});

  // 3) webhook + WhatsApp (opcionales, por config)
  try {
    const [wh, phone, apikey] = await Promise.all([
      prisma.systemConfig.findUnique({ where: { key: 'webhook_url' } }),
      prisma.systemConfig.findUnique({ where: { key: 'callmebot_phone' } }),
      prisma.systemConfig.findUnique({ where: { key: 'callmebot_apikey' } }),
    ]);
    if (wh?.value) {
      fetch(wh.value, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: type, severity, title, body, at: new Date().toISOString() }),
      }).catch((e) => console.warn('[alert:webhook]', e.message));
    }
    if (phone?.value && apikey?.value) {
      const text = encodeURIComponent(`ICON ADS · ${title}\n${body}`);
      fetch(`https://api.callmebot.com/whatsapp.php?phone=${phone.value}&text=${text}&apikey=${apikey.value}`)
        .catch((e) => console.warn('[alert:callmebot]', e.message));
    }
  } catch (e) {
    console.warn('[alert] canales externos:', e.message);
  }
}

module.exports = { sendAlert };
