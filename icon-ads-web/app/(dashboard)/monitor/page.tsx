'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, TabletMonitorEntry } from '@/lib/api';
import { useToast } from '@/lib/toast-context';
import ScreenshotViewer from '@/components/ScreenshotViewer';
import ConfirmDialog from '@/components/ConfirmDialog';
import FilterBar from '@/components/FilterBar';
import { applyFilter, type Filter } from '@/lib/filterEngine';
import { monitorFilterConfig } from '@/lib/monitorFilters';
import { useRole } from '@/lib/roles';

const LS_MONITOR_FILTERS = 'monitor_filters_v1';

const POLL_INTERVAL = 120; // segundos — refresco automático del monitor
const PAGE_SIZE = 25;

const isLongOffline = (e: TabletMonitorEntry) => e.status === 'offline' && e.offlineMinutes > 120;

// Pestañas como en Anuncios. Las "alert" sólo aparecen (en rojo) si tienen algo.
const MONITOR_TABS = [
  { id: 'all', label: 'Todas', match: () => true },
  { id: 'online', label: 'Online', match: (e: TabletMonitorEntry) => e.status === 'online' },
  { id: 'offline', label: 'Offline', match: (e: TabletMonitorEntry) => e.status === 'offline' },
  { id: 'notplaying', label: 'No reproducen', match: (e: TabletMonitorEntry) => e.health === 'no-reproduce' || e.health === 'sin-playlist', alert: true },
  { id: 'blocked', label: 'Bloqueadas', match: (e: TabletMonitorEntry) => e.health === 'blocked', alert: true },
  { id: 'lowbat', label: 'Batería baja', match: (e: TabletMonitorEntry) => e.status === 'online' && e.batteryLevel != null && e.batteryLevel <= 20, alert: true },
  { id: 'longoffline', label: 'Offline +2 h', match: isLongOffline, alert: true },
] as const;
type MonitorTabId = typeof MONITOR_TABS[number]['id'];

function relativeTime(iso: string | null): string {
  if (!iso) return 'Nunca';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `hace ${diff}s`;
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  return `hace ${Math.floor(diff / 86400)}d`;
}

export default function MonitorPage() {
  const [entries, setEntries] = useState<TabletMonitorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(POLL_INTERVAL);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [unblockingId, setUnblockingId] = useState<number | null>(null);
  const [wakingId, setWakingId] = useState<number | null>(null);
  const [wakingAll, setWakingAll] = useState(false);
  const [blockingAll, setBlockingAll] = useState(false);
  const [confirmBlockAll, setConfirmBlockAll] = useState<null | boolean>(null);
  const [brightAuto, setBrightAuto] = useState(true);
  const [brightPct, setBrightPct] = useState(90);
  const [savingBright, setSavingBright] = useState(false);
  const [mFilters, setMFilters] = useState<Filter[]>(() => {
    if (typeof window === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem(LS_MONITOR_FILTERS) ?? '[]'); } catch { return []; }
  });
  const [mSearch, setMSearch] = useState('');
  const [activeTab, setActiveTab] = useState<MonitorTabId>('all');
  const [page, setPage] = useState(1);
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
      setUpdatedAt(new Date());
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

  // eslint-disable-next-line react-hooks/purity -- online / last-sync checks read wall-clock; no compiler/SSR here
  const now = Date.now();
  const searchFn = (e: TabletMonitorEntry) => {
    const q = mSearch.toLowerCase();
    return !q || e.name.toLowerCase().includes(q) || e.deviceId.toLowerCase().includes(q) || (e.zone ?? '').toLowerCase().includes(q);
  };
  const activeTabDef = MONITOR_TABS.find((t) => t.id === activeTab)!;
  const filteredEntries = entries.filter((e) => activeTabDef.match(e) && searchFn(e) && mFilters.every((f) => applyFilter(monitorFilterConfig, f, e, now)));
  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const paged = filteredEntries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const online = entries.filter((e) => e.status === 'online').length;
  const totalPlays = entries.reduce((s, e) => s + e.todayPlays, 0);
  const allBlocked = entries.length > 0 && entries.every((e) => e.health === 'blocked');

  const unblock = async (id: number) => {
    setUnblockingId(id);
    try {
      const r = await api.blockTablet(id, false);
      show(r.message);
      await fetchData();
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error al desbloquear', 'error');
    } finally { setUnblockingId(null); }
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Monitor en vivo</h1>
          {updatedAt && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-xs)' }}>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">{online} de {entries.length} online</span>
              {' · '}{totalPlays.toLocaleString('es-AR')} reproducciones hoy
              {' · '}actualizado a las {updatedAt.toLocaleTimeString('es-AR')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {canManage && (<>
          <button onClick={() => setConfirmBlockAll(!allBlocked)} disabled={blockingAll}
            title={allBlocked ? 'Todas vuelven a mostrar publicidad' : 'Todas dejan de mostrar publicidad (el kiosco sigue armado)'}
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium disabled:opacity-50 ${
              allBlocked
                ? 'hover:bg-emerald-50 dark:hover:bg-emerald-950 text-emerald-700 border-emerald-300'
                : 'hover:bg-amber-50 dark:hover:bg-amber-950 text-amber-700 border-amber-300'
            }`}>
            {blockingAll ? 'Aplicando...' : allBlocked ? 'Desbloquear todas' : 'Bloquear todas'}
          </button>
          <button onClick={wakeAll} disabled={wakingAll}
            title="Manda orden de encendido a toda la flota (las que tengan señal prenden en segundos)"
            className="text-xs px-3 py-1.5 rounded-lg border font-medium hover:bg-blue-50 dark:hover:bg-blue-950 text-blue-600 border-blue-200 disabled:opacity-50">
            {wakingAll ? 'Enviando...' : 'Prender todas'}
          </button>
          </>)}
          <button onClick={() => { fetchData(); resetCountdown(); }} className="text-sm text-blue-600 hover:underline">
            Actualizar
          </button>
          <span className="text-xs px-2 py-1 rounded-full" style={{ background: 'var(--bg)', color: 'var(--text-muted)' }}>
            Auto en {countdown}s
          </span>
        </div>
      </div>

      {/* Brillo de toda la flota (sólo admin: cambiarlo es una escritura) */}
      {canManage && (
      <div className="card p-3 mb-4 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">☀ Brillo de la flota</span>
        <button
          onClick={() => commitBrightness('auto')}
          disabled={savingBright}
          title="Vuelve a la tabla de brillo por horario solar (Ajustes)"
          className={`text-xs px-2.5 py-1 rounded-lg border font-medium disabled:opacity-50 ${
            brightAuto
              ? 'bg-blue-600 text-white border-blue-600'
              : 'text-blue-600 border-blue-200 hover:bg-blue-50 dark:hover:bg-blue-950'
          }`}>
          Auto (solar)
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-[220px]">
          <input
            type="range" min={5} max={100} step={5}
            value={brightPct}
            onChange={(e) => { setBrightPct(Number(e.target.value)); setBrightAuto(false); }}
            onPointerUp={() => commitBrightness(brightPct)}
            onKeyUp={(e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) commitBrightness(brightPct); }}
            disabled={savingBright}
            className="flex-1 accent-blue-600"
          />
          <span className="text-sm font-semibold tabular-nums w-12 text-right">
            {brightAuto ? 'auto' : `${brightPct}%`}
          </span>
        </div>
        <button
          onClick={() => commitBrightness(brightPct)}
          disabled={savingBright}
          className="text-xs px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium">
          {savingBright ? '…' : 'Fijar'}
        </button>
        <span className="text-[11px] w-full sm:w-auto" style={{ color: 'var(--text-muted)' }}>
          Fijar aplica un brillo constante a toda la flota (anula el horario solar hasta que toques &quot;Auto&quot;).
        </span>
      </div>
      )}

      {/* Interruptor maestro: producción congelada */}
      {bw && (
        <div className={`mb-4 p-3 rounded-xl border flex flex-wrap items-center gap-3 ${bw.frozen ? 'border-sky-300 bg-sky-50 dark:bg-sky-950/30 dark:border-sky-800' : 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800'}`}>
          <span className="text-sm font-semibold">
            {bw.frozen ? '🧊 PRODUCCIÓN CONGELADA' : '🟢 Producción activa'}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {bw.frozen
              ? 'Ninguna tablet puede descargar playlists. Siguen reproduciendo su contenido local. Egress de Render ≈ 0.'
              : 'Las tablets pueden descargar playlists (con disyuntor y topes activos).'}
          </span>
          {canManage && <button
            onClick={() => setFreeze(!bw.frozen)}
            disabled={togglingFreeze}
            className={`ml-auto text-xs font-medium px-3 py-1.5 rounded-lg text-white ${bw.frozen ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-sky-600 hover:bg-sky-700'} disabled:opacity-50`}
          >
            {togglingFreeze ? '…' : bw.frozen ? 'Descongelar producción' : 'Congelar producción'}
          </button>}
        </div>
      )}

      {/* Disyuntor de descargas / consumo de ancho de banda */}
      {bw && (bw.circuitOpen || bw.windowGb > 0 || bw.monthGb > 0) && (
        <div className={`mb-4 p-3 rounded-xl border ${bw.circuitOpen ? 'border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800' : 'border-gray-200 dark:border-gray-800'}`}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {bw.circuitOpen ? (
              <span className="font-semibold text-red-700 dark:text-red-400">🚨 Disyuntor de descargas ABIERTO — /package cortado para toda la flota</span>
            ) : (
              <span className="font-medium">Descargas de playlist</span>
            )}
            <span style={{ color: 'var(--text-muted)' }}>
              Ventana {bw.window}: <b>{bw.windowGb.toFixed(2)} GB</b> / {bw.windowBudgetGb} GB
            </span>
            <span style={{ color: 'var(--text-muted)' }}>
              Mes: <b>{bw.monthGb.toFixed(2)} GB</b> (próx. aviso a los {bw.nextAlertGb} GB)
            </span>
            {bw.circuitOpen && canManage && (
              <button onClick={doResetCircuit} disabled={resettingCircuit}
                className="ml-auto text-xs font-medium px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white">
                {resettingCircuit ? 'Reseteando…' : 'Resetear disyuntor'}
              </button>
            )}
          </div>
          {bw.circuitOpen && bw.offenders.length > 0 && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Más pidieron: {bw.offenders.map((o) => `tablet ${o.tabletId} (${o.count})`).join(', ')}
            </p>
          )}
        </div>
      )}

      {/* Estados como pestañas (igual que Anuncios). Las de alerta sólo
          aparecen, en rojo, cuando tienen algo; al pasar el mouse muestran el
          detalle. */}
      <div className="flex flex-wrap gap-2 mb-4">
        {MONITOR_TABS.map((t) => {
          const count = entries.filter(t.match).length;
          const isActive = activeTab === t.id;
          const alertTab = 'alert' in t && t.alert;
          if (alertTab && count === 0 && !isActive) return null;
          const isAlert = alertTab && count > 0;
          const tab = (
            <button
              key={t.id}
              onClick={() => { setActiveTab(t.id); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                isActive ? (isAlert ? 'bg-red-600 border-red-600 text-white' : 'bg-blue-600 border-blue-600 text-white')
                  : isAlert ? 'border-red-300 text-red-700 bg-red-50 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-gray-300 dark:hover:bg-slate-800'
              }`}
            >
              {isAlert && '⚠ '}{t.label} <span className={isActive ? 'text-white/80' : isAlert ? 'text-red-500' : 'text-gray-400'}>{count}</span>
            </button>
          );
          if (!isAlert) return tab;
          return (
            <div key={t.id} className="relative group">
              {tab}
              <div role="tooltip" className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-80 group-hover:block group-focus-within:block">
                <MonitorAlertTip tab={t.id} entries={entries.filter(t.match)} />
              </div>
            </div>
          );
        })}
      </div>

      <FilterBar
        config={monitorFilterConfig}
        rows={entries}
        filters={mFilters}
        onChange={(fs) => { setMFilters(fs); setPage(1); }}
        storageKey={LS_MONITOR_FILTERS}
        search={mSearch}
        onSearch={(q) => { setMSearch(q); setPage(1); }}
        filteredCount={filteredEntries.length}
        total={entries.length}
      />

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No hay tablets registradas.</p>
      ) : filteredEntries.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sin resultados con esos filtros.</p>
      ) : (
        <ul className="card divide-y overflow-hidden" style={{ borderColor: 'var(--border-md)' }}>
          {paged.map((t) => (
            <TabletRow key={t.id} entry={t} canManage={canManage}
              onWake={() => wake(t.id)} waking={wakingId === t.id}
              onUnblock={() => unblock(t.id)} unblocking={unblockingId === t.id} />
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>
          <span>{filteredEntries.length} tablets · página {page} de {totalPages}</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 rounded border disabled:opacity-40" style={{ borderColor: 'var(--border-md)' }}>‹ Anterior</button>
            <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 rounded border disabled:opacity-40" style={{ borderColor: 'var(--border-md)' }}>Siguiente ›</button>
          </div>
        </div>
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
    </div>
  );
}

// Estado de una tablet para la fila: etiqueta, color y tono.
function tabletState(e: TabletMonitorEntry) {
  if (e.health === 'blocked') return { label: 'Bloqueada', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', dot: 'bg-amber-500', warn: true };
  if (e.health === 'sin-playlist') return { label: 'Sin playlist', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', dot: 'bg-red-500 animate-pulse', warn: true };
  if (e.health === 'no-reproduce') {
    return { label: e.onFallback ? 'No cargó playlist' : 'No reproduce', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', dot: 'bg-red-500 animate-pulse', warn: true };
  }
  if (e.status === 'online') return { label: 'Online', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', dot: 'bg-emerald-500 animate-pulse', warn: false };
  if (isLongOffline(e)) return { label: `Offline ${offlineLabel(e.offlineMinutes)}`, cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300', dot: 'bg-orange-500', warn: true };
  return { label: 'Offline', cls: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300', dot: 'bg-gray-400', warn: false };
}

function offlineLabel(min: number) {
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} h`;
  return `${Math.floor(min / 1440)} d`;
}

function TabletRow({ entry: e, canManage, onWake, waking, onUnblock, unblocking }: {
  entry: TabletMonitorEntry; canManage: boolean;
  onWake: () => void; waking: boolean; onUnblock: () => void; unblocking: boolean;
}) {
  const st = tabletState(e);
  const isOnline = e.status === 'online';
  const iconBtn = 'inline-flex items-center justify-center h-7 w-7 rounded-md border transition-colors disabled:opacity-40';
  const who = [e.zone, e.driverName, e.licensePlate].filter(Boolean).join(' · ');
  return (
    <li className={`flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 border-l-4 ${st.warn ? (e.health === 'blocked' ? 'border-l-amber-400' : 'border-l-red-400') : 'border-l-transparent'}`}
      style={{ borderTopColor: 'var(--border)' }}>
      {/* Nombre + estado */}
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${st.dot}`} />
          <Link href={`/tablets/${e.id}`} className="truncate font-medium hover:underline">{e.name}</Link>
          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
        </div>
        <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-xs)', paddingLeft: '1.125rem' }}>
          {who || 'Sin zona'}
        </p>
      </div>

      {/* Conexión + reproducciones */}
      <div className="w-40 shrink-0 text-xs">
        <p>
          <span style={{ color: 'var(--text-muted)' }}>Conexión </span>
          <span className="font-semibold" style={isOnline ? undefined : { color: 'var(--text-muted)' }}>{relativeTime(e.lastSync)}</span>
        </p>
        <p className="mt-0.5">
          <span className={`font-semibold tabular-nums ${e.todayPlays > 0 ? 'text-blue-600 dark:text-blue-400' : ''}`}
            style={e.todayPlays === 0 ? { color: 'var(--text-muted)' } : undefined}>{e.todayPlays.toLocaleString('es-AR')}</span>
          <span style={{ color: 'var(--text-muted)' }}> reproducciones hoy</span>
        </p>
      </div>

      {/* Playlist */}
      <div className="w-40 shrink-0 min-w-0 text-xs">
        <p style={{ color: 'var(--text-xs)' }}>Playlist</p>
        <p className={`truncate font-medium ${e.playlist ? '' : 'text-red-600 dark:text-red-400'}`}>{e.playlist?.name ?? 'Sin asignar'}</p>
      </div>

      {/* Hardware */}
      <div className="flex w-48 shrink-0 flex-wrap gap-x-2.5 gap-y-0.5 text-[11px]" style={{ color: 'var(--text-xs)' }}>
        {e.batteryLevel != null && (
          <span className={e.batteryLevel <= 20 ? 'font-semibold text-red-600 dark:text-red-400' : ''}>🔋 {e.batteryLevel}%</span>
        )}
        {e.brightness != null && (
          <span className={e.brightnessAuto === false ? 'font-medium text-amber-600' : ''}
            title={e.brightnessAuto === false ? 'Brillo en manual' : 'Brillo automático'}>
            ☀ {e.brightness}%{e.lux != null ? ` · ${Math.round(e.lux)} lx` : ''}
          </span>
        )}
        {e.lightSensor === false && <span className="font-medium text-red-500" title="Sin sensor de luz">sin sensor</span>}
        {e.appVersion && <span className="font-mono">v{e.appVersion}</span>}
        {e.serial && <span className="font-mono" title="Nº de serie del hardware">SN {e.serial}</span>}
      </div>

      {/* Acciones */}
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <ScreenshotViewer tabletId={e.id} tabletName={e.name} pill />
        {canManage && e.health === 'blocked' && (
          <button type="button" onClick={onUnblock} disabled={unblocking}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs font-medium whitespace-nowrap border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300 disabled:opacity-40">
            {unblocking ? 'Desbloqueando…' : 'Desbloquear'}
          </button>
        )}
        {canManage && (
          <button type="button" onClick={onWake} disabled={waking}
            title="Prender: enciende la pantalla aunque el auto esté sin contacto (necesita señal)"
            className={`${iconBtn} text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30`} style={{ borderColor: 'var(--border-md)' }}>
            {waking ? '…' : (
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                <path d="M12 3v8M6.3 7.3a8 8 0 1 0 11.4 0" />
              </svg>
            )}
          </button>
        )}
        <Link href={`/tablets/${e.id}`} title="Ver detalle"
          className={`${iconBtn} text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700`} style={{ borderColor: 'var(--border-md)' }}>
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </Link>
      </div>
    </li>
  );
}

// Detalle de cada pestaña de alerta, como tooltip.
function MonitorAlertTip({ tab, entries }: { tab: MonitorTabId; entries: TabletMonitorEntry[] }) {
  const tones = {
    red: { box: 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950', title: 'text-red-800 dark:text-red-200', body: 'text-red-700/90 dark:text-red-300/90' },
    amber: { box: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950', title: 'text-amber-800 dark:text-amber-200', body: 'text-amber-800/90 dark:text-amber-300/90' },
  };
  const n = entries.length;
  const pl = (one: string, many: string) => (n === 1 ? one : many);
  const content: Record<string, { tone: keyof typeof tones; title: string; hint: string; line: (e: TabletMonitorEntry) => string }> = {
    notplaying: {
      tone: 'red',
      title: `${n} ${pl('tablet online NO muestra', 'tablets online NO muestran')} publicidad`,
      hint: 'Tocá "Ver pantalla" en la fila para ver qué está pasando.',
      line: (e) => `${e.name} — ${tabletState(e).label.toLowerCase()}`,
    },
    blocked: {
      tone: 'amber',
      title: `${n} ${pl('tablet bloqueada', 'tablets bloqueadas')} desde el panel`,
      hint: 'No muestran publicidad a propósito. Se desbloquean desde la fila.',
      line: (e) => e.name,
    },
    lowbat: {
      tone: 'red',
      title: `${n} ${pl('tablet', 'tablets')} con batería baja`,
      hint: 'Hablá con el taxista para que la enchufe.',
      line: (e) => [e.name, `${e.batteryLevel}%`, e.driverName, e.licensePlate].filter(Boolean).join(' · '),
    },
    longoffline: {
      tone: 'amber',
      title: `${n} ${pl('tablet', 'tablets')} offline hace más de 2 horas`,
      hint: 'Si están apagadas a propósito, ignoralo.',
      line: (e) => `${e.name} — ${offlineLabel(e.offlineMinutes)}`,
    },
  };
  const c = content[tab];
  if (!c) return null;
  const t = tones[c.tone];
  return (
    <div className={`rounded-xl border p-3 text-sm shadow-lg ${t.box}`}>
      <p className={`font-semibold ${t.title}`}>{c.title}</p>
      <ul className={`mt-1 space-y-0.5 ${t.body}`}>
        {entries.slice(0, 12).map((e) => <li key={e.id}>· {c.line(e)}</li>)}
        {n > 12 && <li>… y {n - 12} más</li>}
      </ul>
      <p className={`mt-1.5 text-xs ${t.body}`}>{c.hint}</p>
    </div>
  );
}
