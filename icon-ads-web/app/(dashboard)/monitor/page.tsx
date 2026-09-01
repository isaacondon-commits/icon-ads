'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, TabletMonitorEntry } from '@/lib/api';
import ScreenshotViewer from '@/components/ScreenshotViewer';

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
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    resetCountdown();
    const poll = setInterval(() => { fetchData(); resetCountdown(); }, POLL_INTERVAL * 1000);
    return () => {
      clearInterval(poll);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const online = entries.filter((e) => e.status === 'online').length;
  const offline = entries.length - online;
  const totalPlays = entries.reduce((s, e) => s + e.todayPlays, 0);
  const alerts = entries.filter((e) => e.status === 'offline' && e.offlineMinutes > 120);
  const notPlaying = entries.filter((e) => e.health === 'no-reproduce');
  const blocked = entries.filter((e) => e.health === 'blocked');

  const unblock = async (id: number) => {
    setUnblockingId(id);
    try {
      await api.updateTablet(id, { manualStatus: 'activa' });
      await fetchData();
    } catch { /* el toast global de errores lo cubre */ } finally { setUnblockingId(null); }
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
          <button onClick={() => { fetchData(); resetCountdown(); }} className="text-sm text-blue-600 hover:underline">
            Actualizar
          </button>
          <span className="text-xs px-2 py-1 rounded-full" style={{ background: 'var(--bg)', color: 'var(--text-muted)' }}>
            Auto en {countdown}s
          </span>
        </div>
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

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No hay tablets registradas.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {entries.map((t) => <TabletCard key={t.id} entry={t} />)}
        </div>
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

function TabletCard({ entry }: { entry: TabletMonitorEntry }) {
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

        {/* Ver pantalla (fuera del Link) */}
        <div className="pt-1 border-t" style={{ borderColor: 'var(--border)' }}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
          <ScreenshotViewer tabletId={entry.id} tabletName={entry.name} />
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
