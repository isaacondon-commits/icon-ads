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

const LS_MONITOR_FILTERS = 'monitor_filters_v1';

const POLL_INTERVAL = 30;

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
  const filteredEntries = entries.filter((e) => searchFn(e) && mFilters.every((f) => applyFilter(monitorFilterConfig, f, e, now)));

  const online = entries.filter((e) => e.status === 'online').length;
  const offline = entries.length - online;
  const totalPlays = entries.reduce((s, e) => s + e.todayPlays, 0);
  const alerts = entries.filter((e) => e.status === 'offline' && e.offlineMinutes > 120);
  const notPlaying = entries.filter((e) => e.health === 'no-reproduce');
  const blocked = entries.filter((e) => e.health === 'blocked');
  const lowBattery = entries.filter((e) => e.status === 'online' && e.batteryLevel != null && e.batteryLevel <= 20);
  const allBlocked = entries.length > 0 && blocked.length === entries.length;

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
              Actualizado a las {updatedAt.toLocaleTimeString('es-AR')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
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
          <button onClick={() => { fetchData(); resetCountdown(); }} className="text-sm text-blue-600 hover:underline">
            Actualizar
          </button>
          <span className="text-xs px-2 py-1 rounded-full" style={{ background: 'var(--bg)', color: 'var(--text-muted)' }}>
            Auto en {countdown}s
          </span>
        </div>
      </div>

      {/* Brillo de toda la flota */}
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
          Fijar aplica un brillo constante a las 12 (anula el horario solar hasta que toques &quot;Auto&quot;).
        </span>
      </div>

      {/* CRÍTICO: online pero sin publicidad */}
      {notPlaying.length > 0 && (
        <div className="mb-4 p-3 rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-800">
          <p className="text-sm font-bold text-red-700 dark:text-red-400">
            🚨 {notPlaying.length} tablet{notPlaying.length > 1 ? 's' : ''} ONLINE pero SIN mostrar publicidad: {notPlaying.map(t => t.name).join(', ')}
          </p>
          <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">Tocá &quot;Ver pantalla&quot; en la tablet para ver qué está pasando.</p>
        </div>
      )}

      {/* Tablets bloqueadas desde el panel — no muestran publicidad a propósito,
          pero hay que verlas acá y poder desbloquearlas sin ir a otra pantalla. */}
      {blocked.length > 0 && (
        <div className="mb-4 p-3 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800">
          <p className="text-sm font-bold text-amber-700 dark:text-amber-400 mb-1.5">
            🔒 {blocked.length} tablet{blocked.length > 1 ? 's' : ''} BLOQUEADA{blocked.length > 1 ? 'S' : ''} — no muestra{blocked.length > 1 ? 'n' : ''} publicidad
          </p>
          <div className="flex flex-wrap gap-2">
            {blocked.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1.5 text-xs bg-white dark:bg-black/20 rounded-full pl-2.5 pr-1 py-1 border border-amber-200 dark:border-amber-800">
                {t.name}
                <button
                  onClick={() => unblock(t.id)}
                  disabled={unblockingId === t.id}
                  className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {unblockingId === t.id ? 'Desbloqueando...' : 'Desbloquear'}
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Batería baja — hay que llamar al taxista para que la enchufe */}
      {lowBattery.length > 0 && (
        <div className="mb-4 p-3 rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-800">
          <p className="text-sm font-bold text-red-700 dark:text-red-400 mb-1">
            🔋 {lowBattery.length} tablet{lowBattery.length > 1 ? 's' : ''} con batería baja — hablá con el taxista
          </p>
          <div className="flex flex-col gap-0.5">
            {lowBattery.map((t) => (
              <p key={t.id} className="text-xs text-red-600 dark:text-red-400">
                <Link href={`/tablets/${t.id}`} className="font-semibold hover:underline">{t.name}</Link>
                {' '}· {t.batteryLevel}%
                {t.zone ? ` · ${t.zone}` : ''}
                {t.driverName ? ` · ${t.driverName}` : ''}
                {t.licensePlate ? ` · ${t.licensePlate}` : ''}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* #4 — offline >2h alert banner */}
      {alerts.length > 0 && (
        <div className="mb-4 p-3 rounded-xl border border-orange-200 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-800">
          <p className="text-sm font-medium text-orange-700 dark:text-orange-400">
            ⚠ {alerts.length} tablet{alerts.length > 1 ? 's' : ''} offline &gt;2h: {alerts.map(t => t.name).join(', ')}
          </p>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <SummaryCard label="Online" value={online} color="text-emerald-600" dotColor="bg-emerald-500" />
        <SummaryCard label="Offline" value={offline} color="text-gray-500" dotColor="bg-gray-400" />
        <SummaryCard label="Reproducciones hoy" value={totalPlays} color="text-blue-600" dotColor="bg-blue-500" />
      </div>

      <FilterBar
        config={monitorFilterConfig}
        rows={entries}
        filters={mFilters}
        onChange={setMFilters}
        storageKey={LS_MONITOR_FILTERS}
        search={mSearch}
        onSearch={setMSearch}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredEntries.map((t) => (
            <TabletCard key={t.id} entry={t} onWake={() => wake(t.id)} waking={wakingId === t.id} />
          ))}
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

function SummaryCard({ label, value, color, dotColor }: { label: string; value: number; color: string; dotColor: string }) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className={`w-3 h-3 rounded-full ${dotColor} flex-shrink-0`} />
      <div>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</p>
      </div>
    </div>
  );
}

function TabletCard({ entry, onWake, waking }: { entry: TabletMonitorEntry; onWake: () => void; waking: boolean }) {
  const isOnline = entry.status === 'online';
  const isLongOffline = !isOnline && entry.offlineMinutes > 120;
  const notPlaying = entry.health === 'no-reproduce';
  const isBlocked = entry.health === 'blocked';
  const onFallback = notPlaying && entry.onFallback === true;
  const notPlayingLabel = onFallback ? 'NO CARGÓ PLAYLIST' : 'NO REPRODUCE';

  return (
    <Link href={`/tablets/${entry.id}`} className="block">
      <div className={`card p-4 flex flex-col gap-3 hover:border-blue-400 transition-colors cursor-pointer ${isBlocked ? 'border-amber-400 dark:border-amber-600' : notPlaying ? 'border-red-400 dark:border-red-600' : isLongOffline ? 'border-orange-300 dark:border-orange-700' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{entry.name}</p>
            {entry.zone && <p className="text-xs truncate" style={{ color: 'var(--text-xs)' }}>{entry.zone}</p>}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className={`w-2 h-2 rounded-full ${isBlocked ? 'bg-amber-500' : notPlaying ? 'bg-red-500 animate-pulse' : isOnline ? 'bg-emerald-500 animate-pulse' : isLongOffline ? 'bg-orange-500' : 'bg-gray-400'}`} />
            <span className={`text-xs font-medium ${isBlocked ? 'text-amber-600' : notPlaying ? 'text-red-600' : isOnline ? 'text-emerald-600' : isLongOffline ? 'text-orange-500' : ''}`}
              style={!isOnline && !isLongOffline && !notPlaying && !isBlocked ? { color: 'var(--text-muted)' } : undefined}>
              {isBlocked ? '🔒 BLOQUEADA' : notPlaying ? notPlayingLabel : isOnline ? 'online' : isLongOffline ? `${Math.floor(entry.offlineMinutes / 60)}h offline` : 'offline'}
            </span>
          </div>
        </div>

        {/* #27 — Quick stats widget */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg p-2" style={{ background: 'var(--bg)' }}>
            <p className="text-[10px] leading-tight" style={{ color: 'var(--text-xs)' }}>Última conexión</p>
            <p className="font-semibold mt-0.5" style={{ color: isOnline ? 'inherit' : 'var(--text-muted)' }}>
              {relativeTime(entry.lastSync)}
            </p>
          </div>
          <div className="rounded-lg p-2" style={{ background: 'var(--bg)' }}>
            <p className="text-[10px] leading-tight" style={{ color: 'var(--text-xs)' }}>Reproducciones hoy</p>
            <p className={`font-semibold mt-0.5 ${entry.todayPlays > 0 ? 'text-blue-600' : ''}`}
              style={entry.todayPlays === 0 ? { color: 'var(--text-muted)' } : undefined}>
              {entry.todayPlays}
            </p>
          </div>
        </div>

        <div className="pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[10px]" style={{ color: 'var(--text-xs)' }}>Playlist</p>
          <p className="text-xs font-medium truncate mt-0.5">
            {entry.playlist?.name ?? <span style={{ color: 'var(--text-muted)' }}>Sin asignar</span>}
          </p>
        </div>

        {/* Acciones (fuera del Link) */}
        <div className="pt-1 border-t flex items-center gap-2 flex-wrap" style={{ borderColor: 'var(--border)' }}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
          <ScreenshotViewer tabletId={entry.id} tabletName={entry.name} />
          <button
            onClick={onWake}
            disabled={waking}
            title="Enciende la pantalla aunque el auto esté sin contacto (necesita señal)"
            className="text-xs px-2.5 py-1 rounded-lg border font-medium hover:bg-blue-50 dark:hover:bg-blue-950 text-blue-600 border-blue-200 disabled:opacity-50"
          >
            {waking ? '...' : 'Prender'}
          </button>
        </div>

        {/* Salud del hardware */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] pt-1 border-t" style={{ borderColor: 'var(--border)', color: 'var(--text-xs)' }}>
          {entry.batteryLevel != null && (
            <span className={entry.batteryLevel <= 20 ? 'text-red-500 font-medium' : ''}>🔋 {entry.batteryLevel}%</span>
          )}
          {entry.brightness != null && (
            <span className={entry.brightnessAuto === false ? 'text-amber-500 font-medium' : ''}
              title={entry.brightnessAuto === false ? 'Brillo en manual — debería estar en automático' : 'Brillo automático'}>
              ☀ {entry.brightness}% {entry.brightnessAuto === false ? '(manual)' : entry.brightnessAuto ? '(auto)' : ''}
              {entry.lux != null && ` · ${Math.round(entry.lux)} lx`}
            </span>
          )}
          {entry.lightSensor === false && (
            <span className="text-red-500 font-medium" title="La tablet no tiene sensor de luz — el brillo automático queda al máximo">
              sin sensor de luz
            </span>
          )}
          {entry.appVersion && <span className="font-mono">v{entry.appVersion}</span>}
          {entry.serial && <span className="font-mono" title="Nº de serie del hardware">SN {entry.serial}</span>}
        </div>
      </div>
    </Link>
  );
}
