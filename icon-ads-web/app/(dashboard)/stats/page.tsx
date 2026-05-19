'use client';

import { useEffect, useState } from 'react';
import { api, WeeklyEntry, RangeStats, HourlyCount, CompletionRate } from '@/lib/api';

const CHART_COLORS = ['#3b82f6','#8b5cf6','#f59e0b','#10b981','#ef4444','#06b6d4'];

function toInputDate(d: Date) { return d.toISOString().slice(0, 10); }

export default function StatsPage() {
  const [weekly, setWeekly] = useState<WeeklyEntry[]>([]);
  const [range, setRange] = useState<RangeStats | null>(null);
  const [heatmap, setHeatmap] = useState<HourlyCount[]>([]);
  const [completion, setCompletion] = useState<CompletionRate[]>([]);
  const [loadingWeekly, setLoadingWeekly] = useState(true);
  const [loadingRange, setLoadingRange] = useState(false);
  const [loadingExtra, setLoadingExtra] = useState(false);

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
    setLoadingExtra(true);
    Promise.allSettled([
      api.getRangeStats(f, t),
      api.getHeatmap(f, t),
      api.getCompletionRate(f, t),
    ]).then(([r, h, c]) => {
      if (r.status === 'fulfilled') setRange(r.value);
      if (h.status === 'fulfilled') setHeatmap(h.value);
      if (c.status === 'fulfilled') setCompletion(c.value);
    }).finally(() => { setLoadingRange(false); setLoadingExtra(false); });
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
                <p className="text-sm font-medium mb-3">Top campañas</p>
                {range.playsByCampaign.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sin datos.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                        <th className="text-left pb-2 w-6">#</th>
                        <th className="text-left pb-2">Campaña</th>
                        <th className="text-right pb-2">Reprod.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {range.playsByCampaign.map((c, i) => (
                        <tr key={c.campaignId} className="border-t" style={{ borderColor: 'var(--border-md)' }}>
                          <td className="py-1.5 pr-2 font-bold text-xs" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                          <td className="py-1.5 truncate max-w-[160px]">{c.campaignName}</td>
                          <td className="py-1.5 text-right font-medium tabular-nums">{c.count.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* By tablet */}
              <div>
                <p className="text-sm font-medium mb-3">Top tablets</p>
                {range.playsByTablet.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sin datos.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                        <th className="text-left pb-2 w-6">#</th>
                        <th className="text-left pb-2">Tablet</th>
                        <th className="text-right pb-2">Reprod.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {range.playsByTablet.map((t, i) => (
                        <tr key={t.tabletId} className="border-t" style={{ borderColor: 'var(--border-md)' }}>
                          <td className="py-1.5 pr-2 font-bold text-xs" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                          <td className="py-1.5 truncate max-w-[160px]">{t.tabletName}</td>
                          <td className="py-1.5 text-right font-medium tabular-nums">{t.count.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* By ad — #14 */}
              <div className="lg:col-span-2">
                <p className="text-sm font-medium mb-3">Top 10 anuncios más reproducidos</p>
                {(range.playsByAd ?? []).length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sin datos.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                        <th className="text-left pb-2 w-6">#</th>
                        <th className="text-left pb-2">Anuncio</th>
                        <th className="text-right pb-2">Reproducciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(range.playsByAd ?? []).map((a, i) => (
                        <tr key={a.adId} className="border-t" style={{ borderColor: 'var(--border-md)' }}>
                          <td className="py-1.5 pr-2 font-bold text-xs" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                          <td className="py-1.5 truncate max-w-[300px]">{a.adName}</td>
                          <td className="py-1.5 text-right font-medium tabular-nums">{a.count.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* #11 — Hourly heatmap */}
            {heatmap.length > 0 && (
              <div className="mt-6">
                <p className="text-sm font-medium mb-3">Reproducciones por hora del día</p>
                {loadingExtra ? (
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
                ) : (
                  <div className="flex items-end gap-0.5 h-28">
                    {heatmap.map((h) => {
                      const maxH = Math.max(...heatmap.map((x) => x.count), 1);
                      const pct = Math.round((h.count / maxH) * 100);
                      return (
                        <div key={h.hour} className="flex-1 flex flex-col items-center gap-0.5" title={`${h.hour}:00 — ${h.count} reproducciones`}>
                          <div className="w-full flex flex-col justify-end" style={{ height: '80px' }}>
                            <div
                              className="w-full rounded-t transition-all duration-300"
                              style={{ height: `${Math.max(pct, h.count > 0 ? 3 : 0)}%`, background: '#3b82f6', opacity: 0.5 + (pct / 200) }}
                            />
                          </div>
                          <span className="text-xs" style={{ color: 'var(--text-xs)', fontSize: '9px' }}>{h.hour}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* #12 — Completion rate */}
            {completion.length > 0 && (
              <div className="mt-6">
                <p className="text-sm font-medium mb-3">Tasa de finalización por anuncio</p>
                {loadingExtra ? (
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                        <th className="text-left pb-2">Anuncio</th>
                        <th className="text-right pb-2">Total</th>
                        <th className="text-right pb-2">Completados</th>
                        <th className="text-right pb-2">Tasa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {completion.map((c) => (
                        <tr key={c.adId} className="border-t" style={{ borderColor: 'var(--border-md)' }}>
                          <td className="py-1.5 truncate max-w-[200px]">{c.adName}</td>
                          <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{c.totalPlays.toLocaleString()}</td>
                          <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{c.completedPlays.toLocaleString()}</td>
                          <td className="py-1.5 text-right font-medium">
                            <span className={`text-xs px-1.5 py-0.5 rounded-full ${c.completionRate >= 80 ? 'bg-emerald-100 text-emerald-700' : c.completionRate >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-600'}`}>
                              {c.completionRate}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
