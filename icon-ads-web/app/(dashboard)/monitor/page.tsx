'use client';

import { useEffect, useRef, useState } from 'react';
import { api, TabletMonitorEntry } from '@/lib/api';
import { useToast } from '@/lib/toast-context';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useRole } from '@/lib/roles';
import TvMonitor from '@/components/monitor/TvMonitor';

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
    </>
  );
}
