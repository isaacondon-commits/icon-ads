// Mails del portal de empresas (invitación y "olvidé mi contraseña"). Salen de
// la cuenta de Gmail de empresas (PORTAL_SMTP_USER) con una contraseña de
// aplicación (PORTAL_SMTP_PASS), separada de la cuenta de alertas internas.

const nodemailer = require('nodemailer');

const FROM_USER = process.env.PORTAL_SMTP_USER || 'empresasiconads@gmail.com';

let transporter = null;
function getTransporter() {
  if (!process.env.PORTAL_SMTP_PASS) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: FROM_USER, pass: process.env.PORTAL_SMTP_PASS },
    });
  }
  return transporter;
}

function portalBaseUrl() {
  const fromEnv = process.env.PORTAL_URL
    || (process.env.FRONTEND_URL || '').split(',').map((s) => s.trim()).find((u) => u.startsWith('https://'))
    || 'http://localhost:3001';
  return fromEnv.replace(/\/+$/, '');
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(title, bodyHtml, buttonText, link) {
  return `<!doctype html><html><body style="margin:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#1d4ed8;padding:22px 28px;color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:1px">ICON ADS</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:20px">${esc(title)}</h1>
${bodyHtml}
<p style="margin:28px 0"><a href="${esc(link)}" style="background:#1d4ed8;color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:999px;font-weight:bold;display:inline-block">${esc(buttonText)}</a></p>
<p style="font-size:12px;color:#6b7280">Si el botón no funciona, copiá este enlace en el navegador:<br><span style="word-break:break-all">${esc(link)}</span></p>
</td></tr>
<tr><td style="padding:16px 28px;background:#f9fafb;font-size:12px;color:#6b7280">ICON ADS nunca te va a pedir tu contraseña por mail, teléfono ni WhatsApp.</td></tr>
</table></td></tr></table></body></html>`;
}

async function send(to, subject, html, text) {
  const t = getTransporter();
  if (!t) return { sent: false, error: 'El envío de mails del portal no está configurado (falta PORTAL_SMTP_PASS).' };
  try {
    await t.sendMail({ from: `"ICON ADS" <${FROM_USER}>`, to, subject, html, text });
    return { sent: true };
  } catch (err) {
    console.warn('[portal-mail]', err.message);
    return { sent: false, error: `No se pudo enviar el mail: ${err.message}` };
  }
}

// El token va en el fragmento (#t=…): el navegador no lo manda al servidor ni
// lo filtra en el Referer.
function sendInvite({ to, clientName, token }) {
  const link = `${portalBaseUrl()}/portal/activar#t=${token}`;
  const body = `<p>Hola${clientName ? ` <b>${esc(clientName)}</b>` : ''}:</p>
<p>Te damos acceso al <b>portal de estadísticas de ICON ADS</b>, donde vas a poder ver cómo se reproducen tus campañas en la flota y descargar reportes en PDF.</p>
<p>Para entrar, creá tu contraseña con el botón de abajo. El enlace es personal, se puede usar una sola vez y vence en <b>48 horas</b>.</p>`;
  const text = `Te damos acceso al portal de estadísticas de ICON ADS.\nCreá tu contraseña (el enlace vence en 48 horas y se usa una sola vez):\n${link}\n\nICON ADS nunca te va a pedir tu contraseña por mail, teléfono ni WhatsApp.`;
  return send(to, 'Tu acceso al portal de estadísticas de ICON ADS', layout('Bienvenido al portal de ICON ADS', body, 'Crear mi contraseña', link), text);
}

function sendReset({ to, token }) {
  const link = `${portalBaseUrl()}/portal/restablecer#t=${token}`;
  const body = `<p>Recibimos un pedido para cambiar la contraseña de tu acceso al portal de ICON ADS.</p>
<p>El enlace vence en <b>1 hora</b> y se puede usar una sola vez. Si no lo pediste vos, ignorá este mail: tu contraseña actual sigue funcionando.</p>`;
  const text = `Para cambiar tu contraseña del portal de ICON ADS (vence en 1 hora):\n${link}\n\nSi no lo pediste vos, ignorá este mail.`;
  return send(to, 'Cambiar tu contraseña del portal de ICON ADS', layout('Cambiar contraseña', body, 'Elegir una nueva contraseña', link), text);
}

module.exports = { sendInvite, sendReset, portalBaseUrl };
