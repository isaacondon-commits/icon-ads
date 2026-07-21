'use client';

import { useEffect, useState } from 'react';
import { api, WeeklyEntry, RangeStats, HourlyCount, CompletionRate, PlaylistStat, AdNoPlays, ZoneStat, SyncInterval, RoiEntry, ZoneHourEntry, SlaStat, MonthlyEntry, TabletAdPlay } from '@/lib/api';

const CHART_COLORS = ['#3b82f6','#8b5cf6','#f59e0b','#10b981','#ef4444','#06b6d4'];

function toInputDate(d: Date) { return d.toISOString().slice(0, 10); }

export default function StatsPage() {
  const [weekly, setWeekly] = useState<WeeklyEntry[]>([]);
  const [range, setRange] = useState<RangeStats | null>(null);
  const [heatmap, setHeatmap] = useState<HourlyCount[]>([]);
  const [completion, setCompletion] = useState<CompletionRate[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistStat[]>([]);
  const [loadingWeekly, setLoadingWeekly] = useState(true);
  const [loadingRange, setLoadingRange] = useState(false);
  const [loadingExtra, setLoadingExtra] = useState(false);
  const [adsNoPlays, setAdsNoPlays] = useState<AdNoPlays[]>([]);
  const [zoneStats, setZoneStats] = useState<ZoneStat[]>([]);
  const [syncIntervals, setSyncIntervals] = useState<SyncInterval[]>([]);
  const [roiStats, setRoiStats] = useState<RoiEntry[]>([]);
  const [zoneHour, setZoneHour] = useState<ZoneHourEntry[]>([]);
  const [slaStats, setSlaStats] = useState<SlaStat[]>([]);
  const [monthly, setMonthly] = useState<MonthlyEntry[]>([]);
  const [tabletAdPlays, setTabletAdPlays] = useState<TabletAdPlay[]>([]);
  const [expandedTablet, setExpandedTablet] = useState<number | null>(null);

  // eslint-disable-next-line react-hooks/purity -- default date range reads wall-clock time; no React Compiler in use, no SSR of this data
  const defaultFrom = toInputDate(new Date(Date.now() - 30 * 86400000));
  const defaultTo = toInputDate(new Date());
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  const fetchRange = (f: string, t: string) => {
    setLoadingRange(true);
    setLoadingExtra(true);
    Promise.allSettled([
      api.getRangeStats(f, t),
      api.getHeatmap(f, t),
      api.getCompletionRate(f, t),
      api.getPlaylistStats(f, t),
      api.getPlaysByTabletAd(f, t),
    ]).then(([r, h, c, p, ta]) => {
      if (r.status === 'fulfilled') setRange(r.value);
      if (h.status === 'fulfilled') setHeatmap(h.value);
      if (c.status === 'fulfilled') setCompletion(c.value);
      if (p.status === 'fulfilled') setPlaylists(p.value);
      if (ta.status === 'fulfilled') setTabletAdPlays(ta.value);
    }).finally(() => { setLoadingRange(false); setLoadingExtra(false); });
  };

  useEffect(() => {
    api.getWeeklyStats(8).then(setWeekly).finally(() => setLoadingWeekly(false));
    api.getPlaylistStats().then(setPlaylists).catch(() => {});
    api.getAdsNoPlays().then(setAdsNoPlays).catch(() => {});
    api.getZoneStats().then(setZoneStats).catch(() => {});
    api.getSyncIntervals().then(setSyncIntervals).catch(() => {});
    api.getRoiStats().then(setRoiStats).catch(() => {});
    api.getZoneHourStats().then(setZoneHour).catch(() => {});
    api.getSlaStats().then(setSlaStats).catch(() => {});
    api.getMonthlyStats().then(setMonthly).catch(() => {});
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount, not a compiler target
    fetchRange(defaultFrom, defaultTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      {/* #38 — Monthly seasonality */}
      {monthly.length > 0 && (
        <div className="card p-6 mb-6">
          <h2 className="font-semibold mb-5">Estacionalidad — últimos 12 meses</h2>
          {(() => {
            const maxM = Math.max(...monthly.map((m) => m.count), 1);
            return (
              <div className="flex items-end gap-2 h-40">
                {monthly.map((m, i) => {
                  const pct = Math.round((m.count / maxM) * 100);
                  const label = m.month.slice(0, 7); // "YYYY-MM"
                  const monthName = new Date(m.month + '-01').toLocaleString('es-AR', { month: 'short' });
                  return (
                    <div key={m.month} className="flex-1 flex flex-col items-center gap-1" title={`${label}: ${m.count}`}>
                      <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {m.count > 0 ? m.count.toLocaleString() : ''}
                      </span>
                      <div className="w-full flex flex-col justify-end" style={{ height: '120px' }}>
                        <div
                          className="w-full rounded-t-md transition-all duration-500"
                          style={{ height: `${Math.max(pct, m.count > 0 ? 4 : 0)}%`, background: CHART_COLORS[i % CHART_COLORS.length] }}
                        />
                      </div>
                      <span className="text-xs text-center" style={{ color: 'var(--text-xs)' }}>{monthName}</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* #3 — Playlist comparison */}
      {playlists.length > 0 && (
        <div className="card p-6 mb-6">
          <h2 className="font-semibold mb-5">Rendimiento por playlist (últimos 30 días)</h2>
          {(() => {
            const maxPlays = Math.max(...playlists.map((p) => p.totalPlays), 1);
            return (
              <div className="space-y-3">
                {playlists.map((p, i) => (
                  <div key={p.playlistId}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium truncate max-w-[60%]">{p.playlistName}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{p.totalPlays.toLocaleString()} reprod. · {p.tabletCount} tablet{p.tabletCount !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="w-full h-2 rounded-full" style={{ background: 'var(--border-md)' }}>
                      <div
                        className="h-2 rounded-full transition-all duration-500"
                        style={{ width: `${Math.max((p.totalPlays / maxPlays) * 100, p.totalPlays > 0 ? 2 : 0)}%`, background: CHART_COLORS[i % CHART_COLORS.length] }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

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

            {/* Qué anuncios reprodujo cada tablet y cuántas veces */}
            <div className="mt-6">
              <p className="text-sm font-medium mb-3">Reproducciones por tablet</p>
              {tabletAdPlays.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sin datos.</p>
              ) : (
                <div className="space-y-1.5">
                  {Object.values(
                    tabletAdPlays.reduce((acc, row) => {
                      if (!acc[row.tabletId]) acc[row.tabletId] = { tabletId: row.tabletId, tabletName: row.tabletName, total: 0, ads: [] };
                      acc[row.tabletId].total += row.count;
                      acc[row.tabletId].ads.push({ adId: row.adId, adName: row.adName, count: row.count });
                      return acc;
                    }, {} as Record<number, { tabletId: number; tabletName: string; total: number; ads: { adId: number; adName: string; count: number }[] }>)
                  )
                    .sort((a, b) => b.total - a.total)
                    .map((tg) => {
                      const open = expandedTablet === tg.tabletId;
                      return (
                        <div key={tg.tabletId} className="rounded-lg border" style={{ borderColor: 'var(--border-md)' }}>
                          <button
                            onClick={() => setExpandedTablet(open ? null : tg.tabletId)}
                            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
                          >
                            <span className="text-sm font-medium flex items-center gap-2">
                              <span className={`text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
                              {tg.tabletName}
                            </span>
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                              {tg.total.toLocaleString()} reproducciones · {tg.ads.length} anuncios distintos
                            </span>
                          </button>
                          {open && (
                            <table className="w-full text-sm border-t" style={{ borderColor: 'var(--border-md)' }}>
                              <tbody>
                                {tg.ads.sort((a, b) => b.count - a.count).map((a) => (
                                  <tr key={a.adId} className="border-t" style={{ borderColor: 'var(--border)' }}>
                                    <td className="py-1.5 px-3 truncate max-w-[300px]">{a.adName}</td>
                                    <td className="py-1.5 px-3 text-right font-medium tabular-nums" style={{ color: 'var(--text-muted)' }}>{a.count.toLocaleString()}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
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

      {/* #11 — Performance by zone */}
      {zoneStats.length > 0 && (
        <div className="card p-6 mt-6">
          <h2 className="font-semibold mb-4">Rendimiento por zona</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  <th className="text-left pb-2">Zona</th>
                  <th className="text-right pb-2">Tablets</th>
                  <th className="text-right pb-2">Online</th>
                  <th className="text-right pb-2">Reproducciones</th>
                  <th className="text-right pb-2">Plays / tablet</th>
                </tr>
              </thead>
              <tbody>
                {zoneStats.map((z) => {
                  const playsPerTablet = z.tablets > 0 ? Math.round(z.plays / z.tablets) : 0;
                  const maxPlays = Math.max(...zoneStats.map((s) => s.plays), 1);
                  const barPct = Math.round((z.plays / maxPlays) * 100);
                  return (
                    <tr key={z.zone} className="border-t" style={{ borderColor: 'var(--border-md)' }}>
                      <td className="py-2.5 font-medium">{z.zone}</td>
                      <td className="py-2.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{z.tablets}</td>
                      <td className="py-2.5 text-right">
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${z.online > 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'}`}>
                          {z.online}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 rounded-full" style={{ background: 'var(--border-md)' }}>
                            <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${barPct}%` }} />
                          </div>
                          <span className="tabular-nums font-medium">{z.plays.toLocaleString()}</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {playsPerTablet.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* #14 — Sync intervals per tablet */}
      {syncIntervals.length > 0 && (
        <div className="card p-6 mt-6">
          <h2 className="font-semibold mb-4">Intervalos de sincronización (últimos 7 días)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  <th className="text-left pb-2">Tablet</th>
                  <th className="text-left pb-2">Zona</th>
                  <th className="text-right pb-2">Syncs</th>
                  <th className="text-right pb-2">Promedio entre syncs</th>
                </tr>
              </thead>
              <tbody>
                {syncIntervals.map((s) => (
                  <tr key={s.tabletId} className="border-t" style={{ borderColor: 'var(--border-md)' }}>
                    <td className="py-2.5 font-medium">{s.tabletName}</td>
                    <td className="py-2.5" style={{ color: 'var(--text-muted)' }}>{s.zone ?? '—'}</td>
                    <td className="py-2.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{s.syncCount}</td>
                    <td className="py-2.5 text-right">
                      {s.avgMinutes != null ? (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          s.avgMinutes <= 6 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : s.avgMinutes <= 15 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                          : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                        }`}>
                          {s.avgMinutes} min
                        </span>
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* #13 — Ads with zero plays */}
      {adsNoPlays.length > 0 && (
        <div className="card p-6 mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Anuncios sin reproducciones</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
              {adsNoPlays.length} anuncio{adsNoPlays.length !== 1 ? 's' : ''}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                <th className="text-left pb-2">Anuncio</th>
                <th className="text-left pb-2">Tipo</th>
                <th className="text-left pb-2">Campaña</th>
                <th className="text-right pb-2">Duración</th>
                <th className="text-right pb-2">Creado</th>
              </tr>
            </thead>
            <tbody>
              {adsNoPlays.map((a) => (
                <tr key={a.id} className="border-t" style={{ borderColor: 'var(--border-md)' }}>
                  <td className="py-2 font-medium max-w-[180px] truncate">{a.name}</td>
                  <td className="py-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${a.type === 'video' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>
                      {a.type}
                    </span>
                  </td>
                  <td className="py-2 max-w-[180px] truncate" style={{ color: 'var(--text-muted)' }}>
                    {a.campaign.name}
                    {!a.campaign.active && (
                      <span className="ml-1 text-xs text-gray-400">(pausada)</span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{a.durationS}s</td>
                  <td className="py-2 text-right text-xs" style={{ color: 'var(--text-xs)' }}>
                    {new Date(a.createdAt).toLocaleDateString('es-AR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* #52 — Zone-hour heatmap */}
      {zoneHour.length > 0 && (() => {
        const zones = [...new Set(zoneHour.map((r) => r.zone))].sort();
        const hours = Array.from({ length: 24 }, (_, i) => i);
        const maxCount = Math.max(...zoneHour.map((r) => r.count), 1);
        const lookup = new Map(zoneHour.map((r) => [`${r.zone}:${r.hour}`, r.count]));
        return (
          <div className="card p-6 mt-6">
            <h2 className="font-semibold mb-4">Reproducciones por zona y hora (últimos 30 días)</h2>
            <div className="overflow-x-auto">
              <table className="text-xs w-full">
                <thead>
                  <tr>
                    <th className="text-left pb-2 pr-3 font-medium" style={{ color: 'var(--text-muted)', minWidth: '100px' }}>Zona</th>
                    {hours.map((h) => (
                      <th key={h} className="text-center pb-2 px-0.5 font-medium tabular-nums" style={{ color: 'var(--text-muted)', minWidth: '22px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {zones.map((zone) => (
                    <tr key={zone}>
                      <td className="pr-3 py-1 font-medium truncate max-w-[100px]" title={zone}>{zone}</td>
                      {hours.map((h) => {
                        const count = lookup.get(`${zone}:${h}`) ?? 0;
                        const intensity = count / maxCount;
                        return (
                          <td key={h} className="px-0.5 py-1 text-center" title={`${zone} ${h}:00 — ${count}`}>
                            <div
                              className="mx-auto rounded"
                              style={{
                                width: '18px', height: '18px',
                                background: count === 0 ? 'var(--border)' : `rgba(59,130,246,${0.15 + intensity * 0.85})`,
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>Cada celda = reproducciones en esa hora. Azul más oscuro = más reproducciones.</p>
          </div>
        );
      })()}

      {/* #59 — SLA compliance */}
      {slaStats.length > 0 && (
        <div className="card p-6 mt-6">
          <h2 className="font-semibold mb-4">Cumplimiento SLA por tablet (últimos 30 días)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  <th className="text-left pb-2">Tablet</th>
                  <th className="text-left pb-2">Zona</th>
                  <th className="text-right pb-2">Días activos</th>
                  <th className="text-right pb-2">Syncs 30d</th>
                  <th className="text-right pb-2">Cobertura</th>
                </tr>
              </thead>
              <tbody>
                {slaStats.map((s) => (
                  <tr key={s.tabletId} className="border-t" style={{ borderColor: 'var(--border-md)' }}>
                    <td className="py-2.5 font-medium">{s.tabletName}</td>
                    <td className="py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{s.zone ?? '—'}</td>
                    <td className="py-2.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{s.activeDays30d} / 30</td>
                    <td className="py-2.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{s.syncCount30d.toLocaleString()}</td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 rounded-full" style={{ background: 'var(--border-md)' }}>
                          <div
                            className={`h-1.5 rounded-full ${s.coveragePct >= 90 ? 'bg-emerald-500' : s.coveragePct >= 60 ? 'bg-amber-400' : 'bg-red-500'}`}
                            style={{ width: `${s.coveragePct}%` }}
                          />
                        </div>
                        <span className={`text-xs font-medium tabular-nums ${s.coveragePct >= 90 ? 'text-emerald-600' : s.coveragePct >= 60 ? 'text-amber-500' : 'text-red-500'}`}>
                          {s.coveragePct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* #15 — ROI / rentabilidad por campaña */}
      {roiStats.length > 0 && (
        <div className="card p-6 mt-6">
          <h2 className="font-semibold mb-4">Rentabilidad estimada por campaña (top 20)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  <th className="text-left pb-2 w-6">#</th>
                  <th className="text-left pb-2">Campaña</th>
                  <th className="text-left pb-2">Cliente</th>
                  <th className="text-right pb-2">CPM</th>
                  <th className="text-right pb-2">Reprod.</th>
                  <th className="text-right pb-2">Ingreso est.</th>
                  <th className="text-right pb-2">vs Presupuesto</th>
                </tr>
              </thead>
              <tbody>
                {roiStats.map((r, i) => {
                  const budgetPct = r.budget && r.budget > 0 ? Math.min(100, Math.round((r.estimatedRevenue / r.budget) * 100)) : null;
                  return (
                    <tr key={r.campaignId} className="border-t" style={{ borderColor: 'var(--border-md)' }}>
                      <td className="py-2.5 pr-2 font-bold text-xs" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                      <td className="py-2.5 font-medium max-w-[160px] truncate">{r.campaignName}</td>
                      <td className="py-2.5 max-w-[120px] truncate" style={{ color: 'var(--text-muted)' }}>{r.clientName}</td>
                      <td className="py-2.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {r.cpm != null ? `$${r.cpm}` : '—'}
                      </td>
                      <td className="py-2.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{r.plays.toLocaleString()}</td>
                      <td className="py-2.5 text-right font-medium tabular-nums text-emerald-600">${r.estimatedRevenue.toFixed(2)}</td>
                      <td className="py-2.5 text-right">
                        {budgetPct != null ? (
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-12 h-1.5 rounded-full" style={{ background: 'var(--border-md)' }}>
                              <div className={`h-1.5 rounded-full ${budgetPct >= 90 ? 'bg-red-500' : budgetPct >= 60 ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${budgetPct}%` }} />
                            </div>
                            <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{budgetPct}%</span>
                          </div>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* #62 — Competitive benchmarks */}
      {roiStats.length > 0 && (() => {
        const avgCpm = roiStats.filter((r) => r.cpm != null).reduce((s, r) => s + (r.cpm ?? 0), 0) / (roiStats.filter((r) => r.cpm != null).length || 1);
        const totalPlaysAll = roiStats.reduce((s, r) => s + r.plays, 0);
        const activeCampaignCount = roiStats.length;

        const benchmarks = [
          {
            label: 'CPM promedio de plataforma',
            actual: avgCpm > 0 ? `$${avgCpm.toFixed(2)}` : '—',
            industry: '$3 – $8',
            ok: avgCpm >= 3 && avgCpm <= 8,
            neutral: avgCpm === 0,
          },
          {
            label: 'Reproducciones por campaña',
            actual: activeCampaignCount > 0 ? Math.round(totalPlaysAll / activeCampaignCount).toLocaleString() : '—',
            industry: '5.000 – 50.000',
            ok: activeCampaignCount > 0 && (totalPlaysAll / activeCampaignCount) >= 5000,
            neutral: activeCampaignCount === 0,
          },
        ];

        return (
          <div className="card p-6 mt-6">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="font-semibold">Benchmarks de industria</h2>
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--border-md)', color: 'var(--text-muted)' }}>referencial</span>
            </div>
            <div className="space-y-4">
              {benchmarks.map((b) => (
                <div key={b.label} className="flex items-center gap-4 text-sm">
                  <div className="flex-1">
                    <p className="font-medium">{b.label}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Industria: {b.industry}</p>
                  </div>
                  <div className="text-right">
                    <p className={`font-bold tabular-nums ${b.neutral ? '' : b.ok ? 'text-emerald-600' : 'text-amber-500'}`}>{b.actual}</p>
                    {!b.neutral && (
                      <p className={`text-xs ${b.ok ? 'text-emerald-600' : 'text-amber-500'}`}>
                        {b.ok ? 'dentro del rango' : 'fuera del rango'}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
              Valores de referencia basados en estándares de publicidad DOOH (Digital Out-of-Home) en Latinoamérica.
            </p>
          </div>
        );
      })()}
    </div>
  );
}
