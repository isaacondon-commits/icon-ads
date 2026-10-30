// Alta / reenvío de la invitación al portal para una empresa. Lo usan las
// rutas de clientes del panel (crear cliente, "reenviar invitación").

const prisma = require('./prisma');
const { newOneTimeToken, INVITE_TTL_MS } = require('./portalAuth');
const { sendInvite } = require('./portalMailer');

/**
 * Crea (o renueva) el acceso de la empresa y le manda el mail de invitación.
 * Si ya tenía contraseña, la sigue teniendo hasta que use el enlace nuevo.
 * Devuelve { sent, error?, expiresAt }.
 */
async function inviteClient(client) {
  const { token, hash } = newOneTimeToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const email = String(client.email).trim().toLowerCase();
  try {
    await prisma.clientUser.upsert({
      where: { clientId: client.id },
      create: { clientId: client.id, email, inviteTokenHash: hash, inviteExpiresAt: expiresAt, invitedAt: new Date() },
      update: { email, active: true, inviteTokenHash: hash, inviteExpiresAt: expiresAt, invitedAt: new Date() },
    });
  } catch (err) {
    if (err.code === 'P2002') return { sent: false, error: `El email ${email} ya tiene acceso al portal con otra empresa.` };
    throw err;
  }
  const r = await sendInvite({ to: email, clientName: client.name, token });
  return { ...r, expiresAt };
}

/** Corta el acceso: desactiva la cuenta y cierra todas sus sesiones al instante. */
async function revokeClient(clientId) {
  const r = await prisma.clientUser.updateMany({
    where: { clientId },
    data: {
      active: false,
      sessionVersion: { increment: 1 },
      inviteTokenHash: null, inviteExpiresAt: null,
      resetTokenHash: null, resetExpiresAt: null,
    },
  });
  return r.count > 0;
}

module.exports = { inviteClient, revokeClient };
