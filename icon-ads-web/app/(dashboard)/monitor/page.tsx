'use client';

import { useEffect, useRef, useState } from 'react';
import { api, Playlist, TabletMonitorEntry } from '@/lib/api';
import { useToast } from '@/lib/toast-context';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useRole } from '@/lib/roles';
import TvMonitor from '@/components/monitor/TvMonitor';
import Modal, { Field } from '@/components/ui/Modal';
import { Btn } from '@/components/ui/buttons';

const POLL_INTERVAL = 120; // segundos — refresco automático del monitor

export default function MonitorPage() {
  const [entries, setEntries] = useState<TabletMonitorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(POLL_INTERVAL);
  const [unblockingId, setUnblockingId] = useState<number | null>(null);
  const [wakingId, setWakingId] = useState<number | null>(null);
  const [wakingAll, setWakingAll] = useState(false);
  const [blockingAll, setBlockingAll] = useState(false);
  const [confirmBlockAll, setConfirmBlockAll] = useState<null | boolean>(null);
  const [brightAuto, setBrightAuto] = useState(true);
  const [brightPct, setBrightPct] = useState(90);
  const [savingBright, setSavingBright] = useState(false);
  const { canManage } = useRole();
  const { show } = useToast();
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadBrightness = () => {
    api.getFleetBrightness().then((b) => {
      setBrightAuto(b.isAuto);
      if (b.pct != null) setBrightPct(b.pct);
    }).catch(() => {});
  };
  const commitBrightness = async (val: number | 'auto') => {
    setSavingBright(true);
    try {
      const r = await api.setFleetBrightness(val === 'auto' ? 'auto' : Math.round((val / 100) * 255));
      setBrightAuto(val === 'auto');
      show(r.message);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error al cambiar el brillo', 'error');
    } finally { setSavingBright(false); }
  };

  const fetchData = async () => {
    try {
      const data = await api.getTabletMonitor();
      setEntries(data);
      setError('');
    } catch {
      setError('Error al cargar datos del monitor');
    } finally {
      setLoading(false);
    }
    api.getBandwidth().then(setBw).catch(() => {});
  };
  const [bw, setBw] = useState<import('@/lib/api').BandwidthStatus | null>(null);
  const [resettingCircuit, setResettingCircuit] = useState(false);
  const [togglingFreeze, setTogglingFreeze] = useState(false);
  const setFreeze = async (next: boolean) => {
    if (!next && !confirm('¿Descongelar producción? Las tablets van a poder volver a descargar playlists (consume ancho de banda de Render). Hacelo solo si ya está la media en R2 o si aceptás el gasto.')) return;
    setTogglingFreeze(true);
    try { const r = await api.setFleetFreeze(next); show(r.message); await fetchData(); }
    catch (e) { show(e instanceof Error ? e.message : 'Error', 'error'); }
    finally { setTogglingFreeze(false); }
  };
  const doResetCircuit = async () => {
    setResettingCircuit(true);
    try { await api.resetCircuit(); await fetchData(); show('Disyuntor reseteado — /package vuelve a servir'); }
    catch (e) { show(e instanceof Error ? e.message : 'Error al resetear', 'error'); }
    finally { setResettingCircuit(false); }
  };

  const resetCountdown = () => {
    setCountdown(POLL_INTERVAL);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown((c) => (c <= 1 ? POLL_INTERVAL : c - 1));
    }, 1000);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch + polling on mount, not a compiler target
    fetchData();
    loadBrightness();
    resetCountdown();
    const poll = setInterval(() => { fetchData(); resetCountdown(); }, POLL_INTERVAL * 1000);
    return () => {
      clearInterval(poll);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const allBlocked = entries.length > 0 && entries.every((e) => e.health === 'blocked');

  // Bloquear / desbloquear una tablet desde su fila.
  const toggleBlock = async (t: TabletMonitorEntry) => {
    const blocking = t.health !== 'blocked';
    setUnblockingId(t.id);
    try {
      const r = await api.blockTablet(t.id, blocking);
      show(r.message);
      await fetchData();
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error al cambiar el estado', 'error');
    } finally { setUnblockingId(null); }
  };

  const [syncingId, setSyncingId] = useState<number | null>(null);
  const forceSync = async (id: number) => {
    setSyncingId(id);
    try {
      const r = await api.forceSync(id);
      show(r.message);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error al forzar sync', 'error');
    } finally { setSyncingId(null); }
  };

  const [deleteTarget, setDeleteTarget] = useState<TabletMonitorEntry | null>(null);
  const deleteTablet = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteTablet(deleteTarget.id);
      show(`"${deleteTarget.name}" eliminada`, 'info');
      setDeleteTarget(null);
      await fetchData();
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error al eliminar', 'error');
      setDeleteTarget(null);
    }
  };

  const wake = async (id: number) => {
    setWakingId(id);
    try {
      const r = await api.wakeTablet(id);
      show(r.message);
    } catch (e) {
      show(e instanceof Error ? e.message : 'No se pudo enviar la orden de encendido', 'error');
    } finally { setWakingId(null); }
  };

  // ── Ex página "Tablets" ────────────────────────────────────────────────────
  const [syncingAll, setSyncingAll] = useState(false);
  const syncAll = async () => {
    setSyncingAll(true);
    try {
      const r = await api.forceSyncAll();
      show(r.message);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error al forzar sync general', 'error');
    } finally { setSyncingAll(false); }
  };
  const exportCsv = () => { window.open(api.getTabletsCsvUrl(), '_blank'); };

  // Alta manual (las tablets normalmente se registran solas al instalar la app;
  // esto sirve para pre-cargar una con su Device ID). ?nueva=1 la abre directo.
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ deviceId: '', name: '', zone: '', playlistId: '' });
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState('');
  const openCreate = () => {
    setCreateForm({ deviceId: '', name: '', zone: '', playlistId: '' });
    setCreateErr('');
    setCreateOpen(true);
    if (!playlists.length) api.getPlaylists().then(setPlaylists).catch(() => {});
  };
  const submitCreate = async () => {
    if (!createForm.deviceId.trim() || !createForm.name.trim()) { setCreateErr('Device ID y nombre son obligatorios.'); return; }
    setCreating(true); setCreateErr('');
    try {
      await api.createTablet({
        deviceId: createForm.deviceId.trim(),
        name: createForm.name.trim(),
        zone: createForm.zone.trim() || undefined,
        playlistId: createForm.playlistId ? Number(createForm.playlistId) : undefined,
      });
      show('Tablet creada');
      setCreateOpen(false);
      await fetchData();
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : 'Error al crear');
    } finally { setCreating(false); }
  };
  useEffect(() => {
    if (!canManage) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('nueva') !== '1') return;
    window.history.replaceState(null, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- abre el alta una vez al llegar con ?nueva=1
    openCreate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  const wakeAll = async () => {
    setWakingAll(true);
    try {
      const r = await api.wakeAllTablets();
      show(r.message);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error al encender la flota', 'error');
    } finally { setWakingAll(false); }
  };

  const blockAll = async (on: boolean) => {
    setConfirmBlockAll(null);
    setBlockingAll(true);
    try {
      const r = await api.blockAllTablets(on);
      show(r.message);
      await fetchData();
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error al cambiar el estado de la flota', 'error');
    } finally { setBlockingAll(false); }
  };

  const dialogs = (
    <>
      {deleteTarget && (
        <ConfirmDialog
          title="Eliminar tablet"
          message={`¿Eliminar "${deleteTarget.name}" del sistema? Se borran también sus métricas e historial. Si la tablet sigue prendida, se vuelve a registrar sola como tablet nueva.`}
          confirmLabel="Eliminar"
          onConfirm={deleteTablet}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {confirmBlockAll !== null && (
        <ConfirmDialog
          title={confirmBlockAll ? 'Bloquear toda la flota' : 'Desbloquear toda la flota'}
          message={confirmBlockAll
            ? `Las ${entries.length} tablets dejan de mostrar publicidad (quedan en negro, el kiosco sigue armado). Se reanuda cuando desbloqueás.`
            : `Las ${entries.length} tablets vuelven a mostrar publicidad.`}
          confirmLabel={confirmBlockAll ? 'Bloquear todas' : 'Desbloquear todas'}
          onConfirm={() => blockAll(confirmBlockAll)}
          onCancel={() => setConfirmBlockAll(null)}
        />
      )}
    </>
  );

  return (
    <>
      <TvMonitor
        entries={entries}
        loading={loading}
        error={error}
        countdown={countdown}
        onRefresh={() => { fetchData(); resetCountdown(); }}
        canManage={canManage}
        actions={{
          wake, wakingId,
          forceSync, syncingId,
          toggleBlock, blockingId: unblockingId,
          remove: setDeleteTarget,
        }}
        fleet={{
          syncingAll, onSyncAll: syncAll,
          onExportCsv: exportCsv,
          onCreate: canManage ? openCreate : undefined,
          allBlocked, blockingAll, onBlockAll: () => setConfirmBlockAll(!allBlocked),
          wakingAll, onWakeAll: wakeAll,
          brightAuto, brightPct, savingBright,
          setBrightPct: (n) => { setBrightPct(n); setBrightAuto(false); },
          commitBrightness,
          bw, togglingFreeze, onFreezeToggle: () => { if (bw) setFreeze(!bw.frozen); },
          resettingCircuit, onResetCircuit: doResetCircuit,
        }}
      />
      {dialogs}
      {createOpen && (
        <Modal title="Nueva tablet" onClose={() => setCreateOpen(false)} closeOnBackdrop={false}>
          <div className="space-y-4">
            <p className="text-sm text-[var(--muted)]">
              Las tablets se registran solas al instalar la app. Usá esto sólo para pre-cargar una tablet con su Device ID.
            </p>
            <Field label="Device ID"><input className="input" value={createForm.deviceId} onChange={(e) => setCreateForm({ ...createForm, deviceId: e.target.value })} placeholder="ANDROID_ID de la tablet" /></Field>
            <Field label="Nombre"><input className="input" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="Taxi 13" /></Field>
            <Field label="Zona (opcional)"><input className="input" value={createForm.zone} onChange={(e) => setCreateForm({ ...createForm, zone: e.target.value })} /></Field>
            <Field label="Playlist (opcional)">
              <select className="input" value={createForm.playlistId} onChange={(e) => setCreateForm({ ...createForm, playlistId: e.target.value })}>
                <option value="">Sin playlist</option>
                {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            {createErr && <p className="text-sm text-[var(--danger)]">{createErr}</p>}
            <div className="flex gap-2 pt-1 [&>button]:flex-1 [&>button]:justify-center">
              <Btn v="primary" onClick={submitCreate} disabled={creating}>{creating ? 'Creando…' : 'Crear tablet'}</Btn>
              <Btn onClick={() => setCreateOpen(false)}>Cancelar</Btn>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
