// Mails del portal de empresas (invitación y "olvidé mi contraseña"). Salen de
// la cuenta de Gmail de empresas (PORTAL_SMTP_USER) con una contraseña de
// aplicación (PORTAL_SMTP_PASS), separada de la cuenta de alertas internas.
//
// Diseño: el prototipo de Isaac (oct-2026). El logo, la franja de arriba y los
// íconos son recortes de ese prototipo (assets/email) y van ADJUNTOS en el mail
// (cid:), así se ven aunque el cliente de correo bloquee imágenes remotas.
// Nada de SVG ni CSS moderno: Gmail/Outlook los ignoran.

const path = require('path');
const nodemailer = require('nodemailer');

const FROM_USER = process.env.PORTAL_SMTP_USER || 'empresasiconads@gmail.com';
const ASSETS = path.join(__dirname, '../../assets/email');

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

// ── Diseño ──────────────────────────────────────────────────────────────────

const C = {
  page: '#eef3fa', card: '#ffffff', navy: '#0b1f4b', blue: '#0a74f0', accent: '#067ffa',
  text: '#0f284e', soft: '#3a6aa8', muted: '#5b7aa6', box: '#f0f8fe', line: '#d3e8fe',
  button: '#066ff8', secTitle: '#0259e5',
};
const FONT = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Imágenes que puede usar un mail: nombre -> archivo en assets/email.
const IMAGES = {
  header: 'header.jpg', footer: 'footer-logo.png', stats: 'ic-stats.png', trend: 'ic-trend.png',
  pdf: 'ic-pdf.png', shield: 'ic-shield.png', lock: 'ic-lock.png', arrow: 'ic-arrow.png',
};
const cid = (name) => `cid:${name}@iconads`;
const attachmentsFor = (names) => names.map((n) => ({ filename: IMAGES[n], path: path.join(ASSETS, IMAGES[n]), cid: `${n}@iconads` }));

function features(items) {
  const cols = items.map((f, i) => `
<td class="col" width="33%" valign="top" style="padding:4px 16px 8px;${i ? `border-left:1px solid ${C.line};` : ''}">
  <img src="${cid(f.icon)}" width="45" height="44" alt="" style="display:block;border:0;margin:0 0 14px">
  <p style="margin:0 0 6px;${FONT};font-size:15px;font-weight:bold;color:${C.navy}">${f.title}</p>
  <p style="margin:0;${FONT};font-size:13px;line-height:19px;color:${C.soft}">${f.text}</p>
</td>`).join('');
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.box};border-radius:14px;margin:26px 0">
  <tr><td style="padding:20px 14px 18px">
    <p style="margin:0 0 16px 16px;${FONT};font-size:18px;font-weight:bold;color:${C.navy}">En el portal vas a poder:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cols}</tr></table>
  </td></tr>
</table>`;
}

function button(text, link) {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:24px auto 28px">
  <tr><td bgcolor="${C.button}" style="background:${C.button};background-image:linear-gradient(#0a76fb,#0268f6);border-radius:999px;box-shadow:0 6px 16px rgba(6,111,248,.28)">
    <a href="${esc(link)}" style="display:block;padding:15px 34px;${FONT};font-size:17px;font-weight:bold;color:#ffffff;text-decoration:none">
      <img src="${cid('lock')}" width="18" height="22" alt="" style="vertical-align:-4px;border:0;margin-right:12px">${esc(text)}<img src="${cid('arrow')}" width="17" height="16" alt="" style="vertical-align:-2px;border:0;margin-left:12px">
    </a>
  </td></tr>
</table>`;
}

function securityBox(points) {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.box};border-radius:12px">
  <tr>
    <td width="96" align="center" valign="middle" style="padding:18px 0">
      <img src="${cid('shield')}" width="44" height="46" alt="" style="display:block;border:0">
    </td>
    <td valign="middle" style="padding:16px 18px;border-left:1px solid ${C.line}">
      <p style="margin:0 0 6px;${FONT};font-size:15px;font-weight:bold;color:${C.secTitle}">Información de seguridad</p>
      ${points.map((p) => `<p style="margin:0 0 3px;${FONT};font-size:13px;line-height:19px;color:${C.text}">&bull;&nbsp; ${p}</p>`).join('')}
    </td>
  </tr>
</table>`;
}

// title: [parte oscura, parte azul]. body: HTML ya escapado.
function layout({ preheader, title, body, buttonText, link, extra = '', security }) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ICON ADS</title>
<style>
  @media (max-width:600px) {
    .wrap { width:100% !important; }
    .pad { padding-left:22px !important; padding-right:22px !important; }
    .h1 { font-size:26px !important; line-height:31px !important; }
    .col { display:block !important; width:auto !important; border-left:0 !important; padding:10px 16px !important; }
  }
</style></head>
<body style="margin:0;padding:0;background:${C.page}">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:24px 10px">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:${C.card};border-radius:16px;overflow:hidden">
  <tr><td bgcolor="#0b2f7a" style="background:#0b2f7a;line-height:0">
    <img src="${cid('header')}" width="600" alt="ICON ADS — Vuela alto con tu publicidad." style="display:block;width:100%;max-width:600px;height:auto;border:0;${FONT};font-size:22px;color:#ffffff">
  </td></tr>
  <tr><td class="pad" style="padding:34px 40px 10px">
    <div style="width:46px;height:4px;background:${C.accent};border-radius:2px;margin:0 0 18px"></div>
    <h1 class="h1" style="margin:0 0 22px;${FONT};font-size:32px;line-height:38px;font-weight:bold;color:${C.navy}">${esc(title[0])}<br><span style="color:${C.blue}">${esc(title[1])}</span></h1>
    ${body}
    ${extra}
    ${button(buttonText, link)}
    ${securityBox(security)}
    <p style="margin:22px 0 4px;${FONT};font-size:12px;color:${C.muted}">Si el botón no funciona, copiá este enlace en el navegador:</p>
    <p style="margin:0 0 26px;${FONT};font-size:12px;word-break:break-all"><a href="${esc(link)}" style="color:${C.blue}">${esc(link)}</a></p>
  </td></tr>
  <tr><td class="pad" style="padding:0 40px 28px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.line}"><tr>
      <td width="104" style="padding:18px 18px 0 0"><img src="${cid('footer')}" width="88" height="45" alt="ICON ADS" style="display:block;border:0"></td>
      <td style="padding:18px 0 0 18px;border-left:1px solid ${C.line};${FONT};font-size:14px;color:${C.soft}">Vuela alto con tu publicidad.</td>
    </tr></table>
    <p style="margin:18px 0 0;${FONT};font-size:11px;color:${C.muted}">ICON ADS nunca te va a pedir tu contraseña por mail, teléfono ni WhatsApp.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

const p = (html, size = 16) => `<p style="margin:0 0 14px;${FONT};font-size:${size}px;line-height:${Math.round(size * 1.55)}px;color:${C.text}">${html}</p>`;
const LAYOUT_IMAGES = ['header', 'footer', 'shield', 'lock', 'arrow'];

async function send(to, subject, html, text, images) {
  const t = getTransporter();
  if (!t) return { sent: false, error: 'El envío de mails del portal no está configurado (falta PORTAL_SMTP_PASS).' };
  try {
    await t.sendMail({ from: `"ICON ADS" <${FROM_USER}>`, to, subject, html, text, attachments: attachmentsFor(images) });
    return { sent: true };
  } catch (err) {
    console.warn('[portal-mail]', err.message);
    return { sent: false, error: `No se pudo enviar el mail: ${err.message}` };
  }
}

// ── Mails ───────────────────────────────────────────────────────────────────

function inviteMail({ clientName, link }) {
  const html = layout({
    preheader: 'Creá tu contraseña para entrar al portal de estadísticas de ICON ADS.',
    title: ['¡Bienvenido al portal de', 'ICON ADS!'],
    body: p(`Hola${clientName ? ` <b>${esc(clientName)}</b>` : ''}:`, 17)
      + p('Te damos acceso al <b>portal de estadísticas de ICON ADS</b>, donde vas a poder ver cómo se reproducen tus anuncios en la flota y descargar reportes en PDF.'),
    extra: features([
      { icon: 'stats', title: 'Ver tus anuncios', text: 'Visualizá cómo se reproducen en la flota.' },
      { icon: 'trend', title: 'Consultar resultados', text: 'Accedé a estadísticas actualizadas de tus anuncios.' },
      { icon: 'pdf', title: 'Descargar reportes', text: 'Obtené informes en PDF para cuando los necesites.' },
    ]) + p('Para ingresar, creá tu contraseña con el botón de abajo.<br>El enlace es personal, se puede usar una sola vez y vence en <b>48 horas</b>.', 15),
    buttonText: 'Crear mi contraseña',
    link,
    security: ['El enlace es personal e intransferible.', 'Solo puede usarse una vez.', 'Vence en 48 horas.'],
  });
  const text = `¡Bienvenido al portal de ICON ADS!\n\nHola${clientName ? ` ${clientName}` : ''}:\nTe damos acceso al portal de estadísticas de ICON ADS, donde vas a poder ver cómo se reproducen tus anuncios en la flota y descargar reportes en PDF.\n\nCreá tu contraseña (el enlace es personal, se usa una sola vez y vence en 48 horas):\n${link}\n\nICON ADS nunca te va a pedir tu contraseña por mail, teléfono ni WhatsApp.`;
  return { subject: 'Tu acceso al portal de estadísticas de ICON ADS', html, text, images: [...LAYOUT_IMAGES, 'stats', 'trend', 'pdf'] };
}

function resetMail({ link }) {
  const html = layout({
    preheader: 'Elegí una contraseña nueva para el portal de ICON ADS.',
    title: ['Cambiá tu contraseña de', 'ICON ADS'],
    body: p('Recibimos un pedido para cambiar la contraseña de tu acceso al <b>portal de estadísticas de ICON ADS</b>.')
      + p('Elegí una nueva con el botón de abajo. Si no lo pediste vos, ignorá este mail: tu contraseña actual sigue funcionando.', 15),
    buttonText: 'Elegir una nueva contraseña',
    link,
    security: ['El enlace es personal e intransferible.', 'Solo puede usarse una vez.', 'Vence en 1 hora.'],
  });
  const text = `Para cambiar tu contraseña del portal de ICON ADS (vence en 1 hora y se usa una sola vez):\n${link}\n\nSi no lo pediste vos, ignorá este mail.`;
  return { subject: 'Cambiar tu contraseña del portal de ICON ADS', html, text, images: LAYOUT_IMAGES };
}

// El token va en el fragmento (#t=…): el navegador no lo manda al servidor ni
// lo filtra en el Referer.
function sendInvite({ to, clientName, token }) {
  const m = inviteMail({ clientName, link: `${portalBaseUrl()}/portal/activar#t=${token}` });
  return send(to, m.subject, m.html, m.text, m.images);
}

function sendReset({ to, token }) {
  const m = resetMail({ link: `${portalBaseUrl()}/portal/restablecer#t=${token}` });
  return send(to, m.subject, m.html, m.text, m.images);
}

// Vista previa: el mail real, desde la misma casilla, con un botón que lleva al
// login del portal (no activa ni cambia ninguna cuenta).
function sendPreview({ to, kind = 'invite', clientName = 'Empresa de prueba' }) {
  const link = `${portalBaseUrl()}/portal`;
  const m = kind === 'reset' ? resetMail({ link }) : inviteMail({ clientName, link });
  return send(to, `[Vista previa] ${m.subject}`, m.html, m.text, m.images);
}

module.exports = { sendInvite, sendReset, sendPreview, portalBaseUrl, inviteMail, resetMail, IMAGES };
