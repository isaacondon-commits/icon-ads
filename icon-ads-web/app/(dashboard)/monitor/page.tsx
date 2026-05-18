'use client';

import { useEffect, useRef, useState } from 'react';
import { api, TabletMonitorEntry } from '@/lib/api';

const POLL_INTERVAL = 15;

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
      setCountdown((c) => {
        if (c <= 1) return POLL_INTERVAL;
        return c - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    fetchData();
    resetCountdown();

    const poll = setInterval(() => {
      fetchData();
      resetCountdown();
    }, POLL_INTERVAL * 1000);

    return () => {
      clearInterval(poll);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const online = entries.filter((e) => e.status === 'online').length;
  const offline = entries.length - online;
  const totalPlays = entries.reduce((s, e) => s + e.todayPlays, 0);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Monitor en vivo</h1>
          {updatedAt && (
            <p className="text-xs text-gray-400 mt-0.5">
              Actualizado a las {updatedAt.toLocaleTimeString('es-AR')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { fetchData(); resetCountdown(); }}
            className="text-sm text-blue-600 hover:underline"
          >
            Actualizar
          </button>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">
            Auto en {countdown}s
          </span>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <SummaryCard label="Online" value={online} color="text-emerald-600" bg="bg-emerald-50" dot="bg-emerald-500" />
        <SummaryCard label="Offline" value={offline} color="text-gray-600" bg="bg-gray-50" dot="bg-gray-400" />
        <SummaryCard label="Reproducciones hoy" value={totalPlays} color="text-blue-600" bg="bg-blue-50" dot="bg-blue-500" />
      </div>

      {/* Tablet grid */}
      {loading ? (
        <p className="text-gray-400 text-sm">Cargando...</p>
      ) : error ? (
        <p className="text-red-500 text-sm">{error}</p>
      ) : entries.length === 0 ? (
        <p className="text-gray-400 text-sm">No hay tablets registradas.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {entries.map((t) => (
            <TabletCard key={t.id} entry={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
  bg,
  dot,
}: {
  label: string;
  value: number;
  color: string;
  bg: string;
  dot: string;
}) {
  return (
    <div className={`${bg} rounded-xl p-4 flex items-center gap-3`}>
      <div className={`w-3 h-3 rounded-full ${dot} flex-shrink-0`} />
      <div>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
    </div>
  );
}

function TabletCard({ entry }: { entry: TabletMonitorEntry }) {
  const isOnline = entry.status === 'online';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-col gap-3">
      {/* Name + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{entry.name}</p>
          {entry.zone && (
            <p className="text-xs text-gray-400 truncate">{entry.zone}</p>
          )}
        </div>
        <StatusDot online={isOnline} />
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <MetricCell
          label="Última conexión"
          value={relativeTime(entry.lastSync)}
          dim={!isOnline}
        />
        <MetricCell
          label="Reproducciones hoy"
          value={entry.todayPlays.toString()}
          highlight={entry.todayPlays > 0}
        />
      </div>

      {/* Playlist */}
      <div className="pt-1 border-t border-gray-50">
        <p className="text-xs text-gray-400">Playlist</p>
        <p className="text-xs font-medium text-gray-700 truncate mt-0.5">
          {entry.playlist?.name ?? <span className="text-gray-400 font-normal">Sin asignar</span>}
        </p>
      </div>
    </div>
  );
}

function StatusDot({ online }: { online: boolean }) {
  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${
          online ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'
        }`}
      />
      <span className={`text-xs font-medium ${online ? 'text-emerald-600' : 'text-gray-400'}`}>
        {online ? 'online' : 'offline'}
      </span>
    </div>
  );
}

function MetricCell({
  label,
  value,
  dim,
  highlight,
}: {
  label: string;
  value: string;
  dim?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="bg-gray-50 rounded-lg p-2">
      <p className="text-gray-400 text-[10px] leading-tight">{label}</p>
      <p
        className={`font-semibold mt-0.5 ${
          dim ? 'text-gray-400' : highlight ? 'text-blue-600' : 'text-gray-700'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
