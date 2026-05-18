'use client';

import { useEffect, useState } from 'react';
import { api, SystemStats } from '@/lib/api';

const CHART_COLORS = [
  '#3b82f6', '#8b5cf6', '#f59e0b', '#10b981',
  '#ef4444', '#06b6d4', '#ec4899', '#84cc16',
];

export default function DashboardPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getStats().then(setStats).finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-gray-500">Cargando estadísticas...</p>;
  if (!stats) return <p className="text-red-500">Error al cargar estadísticas.</p>;

  const statCards = [
    { label: 'Tablets', value: stats.tablets.total, sub: `${stats.tablets.online} online`, color: 'bg-blue-500' },
    { label: 'Clientes', value: stats.clients, color: 'bg-violet-500' },
    { label: 'Campañas', value: stats.campaigns, color: 'bg-amber-500' },
    { label: 'Anuncios', value: stats.ads, color: 'bg-emerald-500' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <a
          href={api.getMetricsCsvUrl()}
          className="text-sm text-blue-600 border border-blue-200 hover:bg-blue-50 px-3 py-1.5 rounded-lg font-medium"
        >
          Exportar CSV
        </a>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className={`w-10 h-10 rounded-lg ${card.color} mb-3`} />
            <p className="text-3xl font-bold">{card.value}</p>
            <p className="text-gray-500 text-sm mt-0.5">{card.label}</p>
            {card.sub && <p className="text-xs text-gray-400 mt-1">{card.sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* #17 — Bar chart: plays per day (7 days) */}
        <BarChart data={stats.dailyPlays} />

        {/* #18 — Donut chart: plays by campaign */}
        <DonutChart data={stats.playsByCampaign} />
      </div>
    </div>
  );
}

function BarChart({ data }: { data: SystemStats['dailyPlays'] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h2 className="font-semibold mb-5">Reproducciones últimos 7 días</h2>
      <div className="flex items-end gap-2 h-40">
        {data.map((d) => {
          const pct = Math.round((d.count / max) * 100);
          const label = d.date.slice(5); // MM-DD
          return (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs text-gray-500 font-medium">{d.count > 0 ? d.count : ''}</span>
              <div className="w-full flex flex-col justify-end" style={{ height: '120px' }}>
                <div
                  className="w-full rounded-t-md bg-blue-500 transition-all duration-500"
                  style={{ height: `${Math.max(pct, d.count > 0 ? 4 : 0)}%` }}
                  title={`${d.date}: ${d.count} reproducciones`}
                />
              </div>
              <span className="text-xs text-gray-400">{label}</span>
            </div>
          );
        })}
      </div>
      {max === 1 && data.every((d) => d.count === 0) && (
        <p className="text-center text-gray-400 text-sm mt-2">Sin datos aún.</p>
      )}
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

  const conicStops = segments
    .map((s) => `${s.color} ${s.offset.toFixed(1)}% ${(s.offset + s.pct).toFixed(1)}%`)
    .join(', ');

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h2 className="font-semibold mb-5">Reproducciones por campaña</h2>
      {total === 0 ? (
        <p className="text-gray-400 text-sm">Sin datos aún.</p>
      ) : (
        <div className="flex items-center gap-6">
          {/* Donut via conic-gradient */}
          <div
            className="shrink-0 rounded-full"
            style={{
              width: 120,
              height: 120,
              background: `conic-gradient(${conicStops})`,
              WebkitMask: 'radial-gradient(farthest-side, transparent 38%, black 38%)',
              mask: 'radial-gradient(farthest-side, transparent 38%, black 38%)',
            }}
            title={`Total: ${total}`}
          />
          {/* Legend */}
          <div className="flex-1 space-y-2 overflow-hidden">
            {segments.map((s) => (
              <div key={s.campaignId} className="flex items-center gap-2 text-sm min-w-0">
                <span
                  className="w-3 h-3 rounded-sm shrink-0"
                  style={{ background: s.color }}
                />
                <span className="truncate text-gray-700 flex-1">{s.campaignName}</span>
                <span className="text-gray-400 shrink-0">{s.pct.toFixed(1)}%</span>
              </div>
            ))}
            <p className="text-xs text-gray-400 pt-1">Total: {total} reproducciones</p>
          </div>
        </div>
      )}
    </div>
  );
}
