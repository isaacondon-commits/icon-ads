const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendTabletOfflineAlert(tablet) {
  if (!process.env.SMTP_USER || !process.env.ALERT_EMAIL) return;
  try {
    await transporter.sendMail({
      from: `"Icon Ads" <${process.env.SMTP_USER}>`,
      to: process.env.ALERT_EMAIL,
      subject: `⚠ Tablet offline: ${tablet.name}`,
      html: `
        <h2>Alerta: tablet offline</h2>
        <p>La tablet <strong>${tablet.name}</strong> (${tablet.deviceId}) lleva más de 2 horas sin conectarse.</p>
        <ul>
          <li>Zona: ${tablet.zone || '—'}</li>
          <li>Última sincronía: ${tablet.lastSync ? new Date(tablet.lastSync).toLocaleString('es-AR') : 'Nunca'}</li>
        </ul>
        <p>Revisá el panel de administración para más detalles.</p>
      `,
    });
  } catch (err) {
    console.warn('[mailer] Failed to send alert:', err.message);
  }
}

module.exports = { sendTabletOfflineAlert };
