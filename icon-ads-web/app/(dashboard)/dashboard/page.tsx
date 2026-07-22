'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, SystemStats, TabletMonitorEntry, StorageStats, WeeklyEntry, AuditPage, RangeStats, DashboardSummary } from '@/lib/api';
import UruguayMap from '@/components/UruguayMap';

const CHART_COLORS = ['#3b82f6','#8b5cf6','#f59e0b','#10b981','#ef4444','#06b6d4','#ec4899','#84cc16'];
const STORAGE_LIMIT_MB = 5000; // 5 GB soft cap for display

export default function DashboardPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [monitor, setMonitor] = useState<TabletMonitorEntry[]>([]);
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const [lastWeek, setLastWeek] = useState<WeeklyEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [recentActivity, setRecentActivity] = useState<AuditPage['logs']>([]);
  const [trend30d, setTrend30d] = useState<RangeStats['dailyPlays']>([]);
  const [serverLatencyMs, setServerLatencyMs] = useState<number | null>(null);
  const [weather, setWeather] = useState<{ temp: number; code: number } | null>(null);
  const isMonday = new Date().getDay() === 1;

  useEffect(() => {
    fetch('https://api.open-meteo.com/v1/forecast?latitude=-34.9011&longitude=-56.1645&current=temperature_2m,weather_code&timezone=America/Montevideo')
      .then((r) => r.json())
      .then((d) => setWeather({ temp: Math.round(d.current.temperature_2m), code: d.current.weather_code }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t0 = Date.now();
    // #21 — single summary call replaces 4 separate requests
    api.getDashboardSummary()
      .then((summary: DashboardSummary) => {
        setServerLatencyMs(Date.now() - t0);
        setStats(summary.stats);
        setMonitor(summary.monitor);
        setTrend30d(summary.trend30d);
        setRecentActivity(summary.recentActivity);
      })
      .catch(() => {
        // fallback to individual calls if summary endpoint fails
        const t1 = Date.now();
        Promise.allSettled([api.getStats(), api.getTabletMonitor()])
          .then(([s, m]) => {
            if (s.status === 'fulfilled') { setStats(s.value); setServerLatencyMs(Date.now() - t1); }
            if (m.status === 'fulfilled') setMonitor(m.value);
          });
        const from30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const to30 = new Date().toISOString().slice(0, 10);
        api.getRangeStats(from30, to30).then((r) => setTrend30d(r.dailyPlays)).catch(() => {});
        api.getAuditLogs(1).then((a) => setRecentActivity(a.logs.slice(0, 10))).catch(() => {});
      })
      .finally(() => setLoading(false));
    // Storage stats kept separate (reads filesystem on server)
    api.getStorageStats().then(setStorage).catch(() => {});
    if (isMonday) api.getWeeklyStats(2).then((weeks) => setLastWeek(weeks[0] ?? null)).catch(() => {});
  }, [isMonday]);

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Cargando estadísticas...</p>;
  if (!stats) return <p className="text-red-500">Error al cargar estadísticas.</p>;
  const storageLimitMB = storage?.quotaMB ?? STORAGE_LIMIT_MB;
  const storagePct = storage ? Math.min(100, Math.round((storage.totalMB / storageLimitMB) * 100)) : 0;

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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Atajos</h1>
          {/* #20 — Server latency indicator */}
          {serverLatencyMs !== null && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-mono font-medium ${
                serverLatencyMs < 800
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : serverLatencyMs < 2500
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                  : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              }`}
              title="Latencia del servidor (tiempo de respuesta de la última llamada a la API)"
            >
              {serverLatencyMs}ms
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* #45 — Weather widget (Open-Meteo, Montevideo) */}
          {weather && (
            <span className="text-sm font-medium flex items-center gap-1 px-2 py-1 rounded-lg" style={{ color: 'var(--text-muted)', background: 'var(--bg)' }}>
              {weatherIcon(weather.code)} {weather.temp}°C MVD
            </span>
          )}
          <a
            href={api.getMetricsCsvUrl()}
            className="text-sm text-blue-600 border border-blue-200 hover:bg-blue-50 dark:hover:bg-blue-950 px-3 py-1.5 rounded-lg font-medium"
          >
            Exportar CSV
          </a>
        </div>
      </div>

      {/* #4 — Monday weekly summary card */}
      {isMonday && lastWeek && (
        <div className="mb-4 p-5 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800">
          <p className="text-sm font-semibold text-blue-700 dark:text-blue-300 mb-1">
            Resumen semana anterior ({lastWeek.from} → {lastWeek.to})
          </p>
          <p className="text-2xl font-bold text-blue-800 dark:text-blue-200">{lastWeek.count.toLocaleString()} reproducciones</p>
        </div>
      )}

      {/* #36 — Quick actions */}
      <div className="flex flex-wrap gap-2 mb-6">
        {[
          { href: '/tablets', label: '+ Nueva tablet', color: 'border-blue-200 text-blue-700 hover:bg-blue-50' },
          { href: '/clients', label: '+ Nuevo cliente', color: 'border-violet-200 text-violet-700 hover:bg-violet-50' },
          { href: '/campaigns', label: '+ Nueva campaña', color: 'border-amber-200 text-amber-700 hover:bg-amber-50' },
          { href: '/ads', label: '+ Subir anuncio', color: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50' },
          { href: '/stats', label: 'Ver estadísticas', color: 'border-gray-200 text-gray-600 hover:bg-gray-50' },
        ].map((a) => (
          <Link key={a.href} href={a.href} className={`text-sm font-medium border px-3 py-1.5 rounded-lg transition-colors dark:border-opacity-30 dark:hover:bg-opacity-10 ${a.color}`}>
            {a.label}
          </Link>
        ))}
      </div>

      {/* #29 — Storage alert when >80% */}
      {storagePct >= 80 && storage && (
        <div className="mb-4 p-4 rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800">
          <p className="text-sm font-semibold text-red-700 dark:text-red-400">
            Almacenamiento al {storagePct}% — {storage.totalMB} MB de {storageLimitMB} MB usados
          </p>
        </div>
      )}

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

      {/* #8 — Próximas a vencer (7 días) — alert cards */}
      {stats.expiringCampaigns.filter((c) => c.daysLeft <= 7).length > 0 && (
        <div className="mb-6">
          <h2 className="font-semibold mb-3 flex items-center gap-2 text-sm">
            <span>⏰</span>
            <span>Próximas a vencer</span>
            <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              {stats.expiringCampaigns.filter((c) => c.daysLeft <= 7).length} en los próximos 7 días
            </span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {stats.expiringCampaigns.filter((c) => c.daysLeft <= 7).map((c) => (
              <Link
                key={c.id}
                href="/campaigns"
                className="card p-4 border-l-4 hover:shadow-md transition-shadow"
                style={{ borderLeftColor: c.daysLeft <= 2 ? '#ef4444' : c.daysLeft <= 5 ? '#f59e0b' : '#eab308' }}
              >
                <div className="flex items-start justify-between mb-1">
                  <p className="font-semibold text-sm leading-tight flex-1 mr-2">{c.name}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-bold shrink-0 ${
                    c.daysLeft <= 2 ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
                    c.daysLeft <= 5 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' :
                    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
                  }`}>
                    {c.daysLeft === 0 ? '¡Hoy!' : `${c.daysLeft}d`}
                  </span>
                </div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.clientName}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-xs)' }}>
                  Vence: {new Date(c.endDate).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* #6 — Executive summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        {statCards.map((card) => (
          <div key={card.label} className="card p-5">
            <div className={`w-10 h-10 rounded-lg ${card.color} mb-3`} />
            <p className="text-3xl font-bold">{card.value}</p>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{card.label}</p>
            {card.sub && <p className="text-xs mt-1" style={{ color: 'var(--text-xs)' }}>{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* #15 — Reach estimation */}
      {stats.tablets.online > 0 && (() => {
        const dailyReach = stats.tablets.online * 8 * 16;
        const monthlyReach = dailyReach * 30;
        return (
          <div className="card p-5 mb-8 flex items-center gap-6">
            <div>
              <p className="text-3xl font-bold text-violet-600">{dailyReach.toLocaleString()}</p>
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Alcance estimado hoy</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-xs)' }}>{stats.tablets.online} tablets × 8 pasajeros × 16 horas activas</p>
            </div>
            <div className="border-l pl-6" style={{ borderColor: 'var(--border-md)' }}>
              <p className="text-xl font-bold">{monthlyReach.toLocaleString()}</p>
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Alcance estimado mensual</p>
            </div>
          </div>
        );
      })()}

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <BarChart data={stats.dailyPlays} />
        <DonutChart data={stats.playsByCampaign} />
      </div>

      {/* #12 — 30-day trend line chart */}
      {trend30d.length > 1 && (
        <div className="card p-6 mb-6">
          <h2 className="font-semibold mb-4">Tendencia últimos 30 días</h2>
          <TrendChart data={trend30d} />
        </div>
      )}

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
                  <span>{storageLimitMB} MB límite</span>
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

      {/* #1 — Recent activity log */}
      {recentActivity.length > 0 && (
        <div className="card p-6 mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Actividad reciente</h2>
            <Link href="/logs" className="text-xs text-blue-600 hover:underline">Ver todo</Link>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {recentActivity.map((log) => (
              <div key={log.id} className="flex items-start justify-between py-2.5 gap-4 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{log.action}</span>
                  <span className="mx-1.5" style={{ color: 'var(--border-md)' }}>·</span>
                  <span style={{ color: 'var(--text-muted)' }}>{log.entity}{log.entityId ? ` #${log.entityId}` : ''}</span>
                  {log.details && (
                    <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-xs)' }}>{log.details}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{log.user?.name ?? 'Sistema'}</p>
                  <p className="text-xs" style={{ color: 'var(--text-xs)' }}>
                    {new Date(log.createdAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function weatherIcon(code: number) {
  if (code === 0) return '☀';
  if (code <= 3) return '⛅';
  if (code <= 48) return '🌫';
  if (code <= 67) return '🌧';
  if (code <= 77) return '❄';
  if (code <= 82) return '🌦';
  return '⛈';
}

function TrendChart({ data }: { data: { date: string; count: number }[] }) {
  if (data.length < 2) return null;
  const w = 600, h = 120;
  const padL = 36, padR = 8, padT = 10, padB = 22;
  const maxY = Math.max(...data.map((d) => d.count), 1);
  const xScale = (i: number) => padL + (i / (data.length - 1)) * (w - padL - padR);
  const yScale = (v: number) => padT + (1 - v / maxY) * (h - padT - padB);
  const linePoints = data.map((d, i) => `${xScale(i)},${yScale(d.count)}`).join(' ');
  const areaPoints = [
    `${xScale(0)},${h - padB}`,
    ...data.map((d, i) => `${xScale(i)},${yScale(d.count)}`),
    `${xScale(data.length - 1)},${h - padB}`,
  ].join(' ');
  const midY = Math.round(maxY / 2);
  const labelIdxs = [0, Math.floor(data.length / 2), data.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 120 }}>
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={padL} y1={yScale(maxY)} x2={w - padR} y2={yScale(maxY)} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3 3" />
      <line x1={padL} y1={yScale(midY)} x2={w - padR} y2={yScale(midY)} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3 3" />
      <text x={padL - 4} y={yScale(maxY) + 4} textAnchor="end" fontSize="9" fill="var(--text-xs)">{maxY}</text>
      <text x={padL - 4} y={yScale(midY) + 4} textAnchor="end" fontSize="9" fill="var(--text-xs)">{midY}</text>
      <text x={padL - 4} y={yScale(0) + 4} textAnchor="end" fontSize="9" fill="var(--text-xs)">0</text>
      <polygon points={areaPoints} fill="url(#trendFill)" />
      <polyline points={linePoints} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {labelIdxs.map((i) => (
        <text key={i} x={xScale(i)} y={h} textAnchor="middle" fontSize="9" fill="var(--text-xs)">
          {data[i].date.slice(5)}
        </text>
      ))}
    </svg>
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
