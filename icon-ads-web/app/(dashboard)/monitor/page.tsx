'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, TabletMonitorEntry } from '@/lib/api';

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
    fetchData();
    resetCountdown();
    const poll = setInterval(() => { fetchData(); resetCountdown(); }, POLL_INTERVAL * 1000);
    return () => {
      clearInterval(poll);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const online = entries.filter((e) => e.status === 'online').length;
  const offline = entries.length - online;
  const totalPlays = entries.reduce((s, e) => s + e.todayPlays, 0);
  const alerts = entries.filter((e) => e.status === 'offline' && e.offlineMinutes > 120);

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

  return (
    <Link href={`/tablets/${entry.id}`} className="block">
      <div className={`card p-4 flex flex-col gap-3 hover:border-blue-400 transition-colors cursor-pointer ${isLongOffline ? 'border-orange-300 dark:border-orange-700' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{entry.name}</p>
            {entry.zone && <p className="text-xs truncate" style={{ color: 'var(--text-xs)' }}>{entry.zone}</p>}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : isLongOffline ? 'bg-orange-500' : 'bg-gray-400'}`} />
            <span className={`text-xs font-medium ${isOnline ? 'text-emerald-600' : isLongOffline ? 'text-orange-500' : ''}`}
              style={!isOnline && !isLongOffline ? { color: 'var(--text-muted)' } : undefined}>
              {isOnline ? 'online' : isLongOffline ? `${Math.floor(entry.offlineMinutes / 60)}h offline` : 'offline'}
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
      </div>
    </Link>
  );
}
