'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ClientPortalStatus } from '@/lib/api';
import { useToast } from '@/lib/toast-context';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Btn } from '@/components/ui/buttons';

const EVENT_LABEL: Record<string, string> = {
  PORTAL_LOGIN: 'Ingresó',
  PORTAL_LOGIN_FAILED: 'Contraseña incorrecta',
  PORTAL_ACTIVATED: 'Activó la cuenta',
  PORTAL_PASSWORD_RESET: 'Restableció la contraseña',
  PORTAL_PASSWORD_CHANGED: 'Cambió la contraseña',
  PORTAL_RESET_REQUESTED: 'Pidió cambiar la contraseña',
};

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('es-UY', { timeZone: 'America/Montevideo' }) : '—');

// Acceso de la empresa al portal de estadísticas: estado, últimos ingresos,
// reenviar invitación y cortar el acceso. Va dentro de "Editar cliente".
export default function ClientPortalAccess({ clientId }: { clientId: number }) {
  const { show } = useToast();
  const [status, setStatus] = useState<ClientPortalStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const load = useCallback(() => {
    api.getClientPortal(clientId).then(setStatus).catch(() => setStatus({ exists: false }));
  }, [clientId]);
  useEffect(load, [load]);

  const invite = async () => {
    setBusy(true);
    try {
      await api.inviteClientPortal(clientId);
      show('Invitación enviada. El enlace vence en 48 horas.');
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : 'No se pudo enviar la invitación', 'error');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setConfirmRevoke(false);
    setBusy(true);
    try {
      await api.revokeClientPortal(clientId);
      show('Acceso cortado. Sus sesiones se cerraron.');
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : 'No se pudo cortar el acceso', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <div className="skeleton h-16 w-full" />;

  let label = 'Sin acceso';
  let color = 'var(--muted-2)';
  if (status.exists && !status.active) { label = 'Acceso cortado'; color = 'var(--danger)'; }
  else if (status.exists && status.activated) { label = 'Activo'; color = 'var(--ok)'; }
  else if (status.exists && status.inviteExpiresAt && new Date(status.inviteExpiresAt) > new Date()) { label = 'Invitación pendiente'; color = 'var(--warn)'; }
  else if (status.exists) { label = 'Invitación vencida'; color = 'var(--warn)'; }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Portal de estadísticas</p>
        <span className="inline-flex items-center gap-1.5 text-xs" style={{ color }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />{label}
        </span>
      </div>
      {status.exists && (
        <div className="mb-3 space-y-0.5 text-xs text-[var(--muted)]">
          <p>Usuario: {status.email}</p>
          {status.activated
            ? <p>Último ingreso: {when(status.lastLoginAt)}{status.lastLoginIp ? ` · IP ${status.lastLoginIp}` : ''}</p>
            : <p>Invitado: {when(status.invitedAt)}{status.inviteExpiresAt ? ` · vence ${when(status.inviteExpiresAt)}` : ''}</p>}
          {status.lockedUntil && <p className="text-[var(--warn)]">Frenada por intentos fallidos hasta {when(status.lockedUntil)}</p>}
        </div>
      )}
      {!!status.events?.length && (
        <details className="mb-3 text-xs text-[var(--muted)]">
          <summary className="cursor-pointer">Actividad reciente</summary>
          <ul className="mt-1 space-y-0.5">
            {status.events.map((e, i) => (
              <li key={i}>{when(e.createdAt)} — {EVENT_LABEL[e.action] ?? e.action}{e.ip ? ` · ${e.ip}` : ''}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        <Btn size="sm" onClick={invite} disabled={busy}>
          {!status.exists ? 'Enviar invitación' : status.activated ? 'Enviar enlace para nueva contraseña' : 'Reenviar invitación'}
        </Btn>
        {status.exists && status.active && (
          <Btn size="sm" v="danger" onClick={() => setConfirmRevoke(true)} disabled={busy}>Cortar acceso</Btn>
        )}
      </div>
      {confirmRevoke && (
        <ConfirmDialog
          title="Cortar acceso al portal"
          message="La empresa deja de poder entrar y se cierran sus sesiones al instante. Podés volver a invitarla cuando quieras."
          confirmLabel="Cortar acceso"
          onConfirm={revoke}
          onCancel={() => setConfirmRevoke(false)}
        />
      )}
    </div>
  );
}
