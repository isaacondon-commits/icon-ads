'use client';

import { useEffect, useState } from 'react';
import { api, SystemStats, TabletMonitorEntry, StorageStats } from '@/lib/api';
import UruguayMap from '@/components/UruguayMap';

const CHART_COLORS = ['#3b82f6','#8b5cf6','#f59e0b','#10b981','#ef4444','#06b6d4','#ec4899','#84cc16'];
const STORAGE_LIMIT_MB = 5000; // 5 GB soft cap for display

export default function DashboardPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [monitor, setMonitor] = useState<TabletMonitorEntry[]>([]);
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getStats(), api.getTabletMonitor(), api.getStorageStats()])
      .then(([s, m, st]) => { setStats(s); setMonitor(m); setStorage(st); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Cargando estadísticas...</p>;
  if (!stats) return <p className="text-red-500">Error al cargar estadísticas.</p>;

  // Offline >2h tablets (#4)
  const offlineAlerts = monitor.filter((t) => t.status === 'offline' && t.offlineMinutes > 120);

  // Active zones for map (#5)
  const activeZones = monitor.filter((t) => t.status === 'online' && t.zone).map((t) => t.zone!);

  const statCards = [
    { label: 'Tablets', value: stats.tablets.total, sub: `${stats.tablets.online} online`, color: 'bg-blue-500' },
    { label: 'Clientes', value: stats.clients, color: 'bg-violet-500' },
    { label: 'Campañas', value: stats.campaigns, color: 'bg-amber-500' },
    { label: 'Total reproducciones', value: stats.totalPlays.toLocaleString(), color: 'bg-emerald-500' },
  ];

  const storagePct = storage ? Math.min(100, Math.round((storage.totalMB / STORAGE_LIMIT_MB) * 100)) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <a
          href={api.getMetricsCsvUrl()}
          className="text-sm text-blue-600 border border-blue-200 hover:bg-blue-50 dark:hover:bg-blue-950 px-3 py-1.5 rounded-lg font-medium"
        >
          Exportar CSV
        </a>
      </div>

      {/* #4 — Offline alerts (>2h) */}
      {offlineAlerts.length > 0 && (
        <div className="mb-4 p-4 rounded-xl border border-orange-200 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-800">
          <p className="text-sm font-semibold text-orange-700 dark:text-orange-400 mb-2">
            ⚠ {offlineAlerts.length} tablet{offlineAlerts.length > 1 ? 's' : ''} offline hace más de 2 horas
          </p>
          <div className="flex flex-wrap gap-2">
            {offlineAlerts.map((t) => (
              <span key={t.id} className="text-xs bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 px-2 py-1 rounded-full">
                {t.name} · {Math.floor(t.offlineMinutes / 60)}h {t.offlineMinutes % 60}m
              </span>
            ))}
          </div>
        </div>
      )}

      {/* #16 — Expiring campaign alerts */}
      {stats.expiringCampaigns.length > 0 && (
        <div className="mb-4 p-4 rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800">
          <p className="text-sm font-semibold text-red-700 dark:text-red-400 mb-2">
            ⏰ Campañas que vencen pronto
          </p>
          <div className="flex flex-wrap gap-2">
            {stats.expiringCampaigns.map((c) => (
              <span key={c.id} className={`text-xs px-2 py-1 rounded-full font-medium ${
                c.daysLeft <= 3 ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300'
              }`}>
                {c.name} · {c.daysLeft}d
              </span>
            ))}
          </div>
        </div>
      )}

      {/* #6 — Executive summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((card) => (
          <div key={card.label} className="card p-5">
            <div className={`w-10 h-10 rounded-lg ${card.color} mb-3`} />
            <p className="text-3xl font-bold">{card.value}</p>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{card.label}</p>
            {card.sub && <p className="text-xs mt-1" style={{ color: 'var(--text-xs)' }}>{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <BarChart data={stats.dailyPlays} />
        <DonutChart data={stats.playsByCampaign} />
      </div>

      {/* Map + Storage row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* #5 — Uruguay map */}
        <div className="card p-6">
          <h2 className="font-semibold mb-4">Zonas con tablets activas</h2>
          <UruguayMap activeZones={activeZones} />
        </div>

        {/* #28 — Storage bar + tablet status */}
        <div className="space-y-6">
          <div className="card p-6">
            <h2 className="font-semibold mb-4">Almacenamiento</h2>
            {storage && (
              <>
                <div className="flex justify-between text-sm mb-2" style={{ color: 'var(--text-muted)' }}>
                  <span>{storage.totalMB} MB usados</span>
                  <span>{STORAGE_LIMIT_MB} MB límite</span>
                </div>
                <div className="w-full rounded-full h-3" style={{ background: 'var(--border-md)' }}>
                  <div
                    className={`h-3 rounded-full transition-all duration-700 ${storagePct > 80 ? 'bg-red-500' : storagePct > 60 ? 'bg-amber-500' : 'bg-blue-500'}`}
                    style={{ width: `${storagePct}%` }}
                  />
                </div>
                <p className="text-xs mt-2" style={{ color: 'var(--text-xs)' }}>
                  {storage.fileCount} archivos · {storage.adCount} anuncios activos
                </p>
              </>
            )}
          </div>

          <div className="card p-6">
            <h2 className="font-semibold mb-3">Tablets recientes</h2>
            <div className="space-y-2">
              {monitor.slice(0, 5).map((t) => (
                <div key={t.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${t.status === 'online' ? 'bg-emerald-400' : 'bg-gray-400'}`} />
                    <span className="text-sm font-medium">{t.name}</span>
                  </div>
                  <span className="text-xs" style={{ color: 'var(--text-xs)' }}>{t.todayPlays} hoy</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BarChart({ data }: { data: SystemStats['dailyPlays'] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="card p-6">
      <h2 className="font-semibold mb-5">Reproducciones últimos 7 días</h2>
      <div className="flex items-end gap-2 h-40">
        {data.map((d) => {
          const pct = Math.round((d.count / max) * 100);
          return (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{d.count > 0 ? d.count : ''}</span>
              <div className="w-full flex flex-col justify-end" style={{ height: '120px' }}>
                <div
                  className="w-full rounded-t-md bg-blue-500 transition-all duration-500"
                  style={{ height: `${Math.max(pct, d.count > 0 ? 4 : 0)}%` }}
                  title={`${d.date}: ${d.count}`}
                />
              </div>
              <span className="text-xs" style={{ color: 'var(--text-xs)' }}>{d.date.slice(5)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DonutChart({ data }: { data: SystemStats['playsByCampaign'] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  const segments = (() => {
    if (total === 0) return [];
    let offset = 0;
    return data.map((d, i) => {
      const pct = (d.count / total) * 100;
      const seg = { ...d, pct, offset, color: CHART_COLORS[i % CHART_COLORS.length] };
      offset += pct;
      return seg;
    });
  })();
  const conicStops = segments.map((s) => `${s.color} ${s.offset.toFixed(1)}% ${(s.offset + s.pct).toFixed(1)}%`).join(', ');

  return (
    <div className="card p-6">
      <h2 className="font-semibold mb-5">Reproducciones por campaña</h2>
      {total === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sin datos aún.</p>
      ) : (
        <div className="flex items-center gap-6">
          <div
            className="shrink-0 rounded-full"
            style={{
              width: 120, height: 120,
              background: `conic-gradient(${conicStops})`,
              WebkitMask: 'radial-gradient(farthest-side, transparent 38%, black 38%)',
              mask: 'radial-gradient(farthest-side, transparent 38%, black 38%)',
            }}
          />
          <div className="flex-1 space-y-2 overflow-hidden">
            {segments.map((s) => (
              <div key={s.campaignId} className="flex items-center gap-2 text-sm min-w-0">
                <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: s.color }} />
                <span className="truncate flex-1">{s.campaignName}</span>
                <span className="shrink-0" style={{ color: 'var(--text-xs)' }}>{s.pct.toFixed(1)}%</span>
              </div>
            ))}
            <p className="text-xs pt-1" style={{ color: 'var(--text-xs)' }}>Total: {total}</p>
          </div>
        </div>
      )}
    </div>
  );
}
