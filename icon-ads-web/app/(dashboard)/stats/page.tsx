'use client';

import { useEffect, useState } from 'react';
import { api, WeeklyEntry, RangeStats } from '@/lib/api';

const CHART_COLORS = ['#3b82f6','#8b5cf6','#f59e0b','#10b981','#ef4444','#06b6d4'];

function toInputDate(d: Date) { return d.toISOString().slice(0, 10); }

export default function StatsPage() {
  const [weekly, setWeekly] = useState<WeeklyEntry[]>([]);
  const [range, setRange] = useState<RangeStats | null>(null);
  const [loadingWeekly, setLoadingWeekly] = useState(true);
  const [loadingRange, setLoadingRange] = useState(false);

  const defaultFrom = toInputDate(new Date(Date.now() - 30 * 86400000));
  const defaultTo = toInputDate(new Date());
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  useEffect(() => {
    api.getWeeklyStats(8).then(setWeekly).finally(() => setLoadingWeekly(false));
    fetchRange(defaultFrom, defaultTo);
  }, []);

  const fetchRange = (f: string, t: string) => {
    setLoadingRange(true);
    api.getRangeStats(f, t).then(setRange).finally(() => setLoadingRange(false));
  };

  const maxWeekly = Math.max(...weekly.map((w) => w.count), 1);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Estadísticas</h1>

      {/* #20 — Week-over-week */}
      <div className="card p-6 mb-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold">Semana a semana (últimas 8 semanas)</h2>
          <a href={api.getMetricsCsvUrl()} className="text-xs text-blue-600 hover:underline">Exportar CSV</a>
        </div>
        {loadingWeekly ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
        ) : (
          <div className="flex items-end gap-2 h-48">
            {weekly.map((w, i) => {
              const pct = Math.round((w.count / maxWeekly) * 100);
              return (
                <div key={w.week} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{w.count > 0 ? w.count : ''}</span>
                  <div className="w-full flex flex-col justify-end" style={{ height: '140px' }}>
                    <div
                      className="w-full rounded-t-md transition-all duration-500"
                      style={{ height: `${Math.max(pct, w.count > 0 ? 4 : 0)}%`, background: CHART_COLORS[i % CHART_COLORS.length] }}
                      title={`${w.from} → ${w.to}: ${w.count}`}
                    />
                  </div>
                  <span className="text-xs text-center" style={{ color: 'var(--text-xs)' }}>{w.week}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* #13 — Date range filter */}
      <div className="card p-6">
        <h2 className="font-semibold mb-4">Filtro por rango de fechas</h2>
        <div className="flex flex-wrap gap-3 mb-5">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Desde</label>
            <input type="date" className="input w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Hasta</label>
            <input type="date" className="input w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => fetchRange(from, to)}
              disabled={loadingRange}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              {loadingRange ? 'Buscando...' : 'Aplicar'}
            </button>
          </div>
        </div>

        {range && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              {[
                { label: 'Total reproducciones', value: range.totalPlays.toLocaleString() },
                { label: 'Campañas', value: range.playsByCampaign.length },
                { label: 'Tablets', value: range.playsByTablet.length },
                { label: 'Días', value: range.dailyPlays.filter(d => d.count > 0).length },
              ].map((s) => (
                <div key={s.label} className="card p-4">
                  <p className="text-2xl font-bold">{s.value}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* By campaign */}
              <div>
                <p className="text-sm font-medium mb-3">Por campaña</p>
                <div className="space-y-2">
                  {range.playsByCampaign.map((c, i) => {
                    const maxC = Math.max(...range.playsByCampaign.map(x => x.count), 1);
                    const pct = Math.round((c.count / maxC) * 100);
                    return (
                      <div key={c.campaignId}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="truncate max-w-[180px]">{c.campaignName}</span>
                          <span style={{ color: 'var(--text-muted)' }}>{c.count.toLocaleString()}</span>
                        </div>
                        <div className="w-full h-2 rounded-full" style={{ background: 'var(--border-md)' }}>
                          <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* By tablet */}
              <div>
                <p className="text-sm font-medium mb-3">Por tablet</p>
                <div className="space-y-2">
                  {range.playsByTablet.map((t, i) => {
                    const maxT = Math.max(...range.playsByTablet.map(x => x.count), 1);
                    const pct = Math.round((t.count / maxT) * 100);
                    return (
                      <div key={t.tabletId}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="truncate max-w-[180px]">{t.tabletName}</span>
                          <span style={{ color: 'var(--text-muted)' }}>{t.count.toLocaleString()}</span>
                        </div>
                        <div className="w-full h-2 rounded-full" style={{ background: 'var(--border-md)' }}>
                          <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: CHART_COLORS[(i + 3) % CHART_COLORS.length] }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
