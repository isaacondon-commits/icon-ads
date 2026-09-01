'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  api, WeeklyEntry, RangeStats, HourlyCount, DayHourCount, CompletionRate, PlaylistStat,
  AdNoPlays, ZoneStat, SyncInterval, ZoneHourEntry, SlaStat, MonthlyEntry, DailyEntry,
  TabletAdPlay, TabletMonitorEntry, Campaign, Tablet,
} from '@/lib/api';
import InfoTip from '@/components/InfoTip';
import RefreshButton from '@/components/RefreshButton';

const ACCENT = '#3b82f6';

function toInputDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function firstOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function daysBetween(a: string, b: string) {
  return Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1);
}
const nf = (n: number) => n.toLocaleString('es-UY');

type TrendMode = 'day' | 'week' | 'month';

export default function StatsPage() {
  // ── Filtros globales ──────────────────────────────────────────────────────
  const today = toInputDate(new Date());
  const [from, setFrom] = useState(toInputDate(firstOfMonth()));
  const [to, setTo] = useState(today);
  const [campaignId, setCampaignId] = useState<number | ''>('');
  const [tabletId, setTabletId] = useState<number | ''>('');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tablets, setTablets] = useState<Tablet[]>([]);

  // ── Datos ────────────────────────────────────────────────────────────────
  const [range, setRange] = useState<RangeStats | null>(null);
  const [daily, setDaily] = useState<DailyEntry[]>([]);
  const [weekly, setWeekly] = useState<WeeklyEntry[]>([]);
  const [monthly, setMonthly] = useState<MonthlyEntry[]>([]);
  const [heatmap, setHeatmap] = useState<HourlyCount[]>([]);
  const [heatmapByDay, setHeatmapByDay] = useState<DayHourCount[]>([]);
  const [completion, setCompletion] = useState<CompletionRate[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistStat[]>([]);
  const [adsNoPlays, setAdsNoPlays] = useState<AdNoPlays[]>([]);
  const [zoneStats, setZoneStats] = useState<ZoneStat[]>([]);
  const [syncIntervals, setSyncIntervals] = useState<SyncInterval[]>([]);
  const [zoneHour, setZoneHour] = useState<ZoneHourEntry[]>([]);
  const [slaStats, setSlaStats] = useState<SlaStat[]>([]);
  const [tabletAdPlays, setTabletAdPlays] = useState<TabletAdPlay[]>([]);
  const [monitor, setMonitor] = useState<TabletMonitorEntry[]>([]);

  const [loadingRange, setLoadingRange] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [trendMode, setTrendMode] = useState<TrendMode>('day');
  const [expandedTablet, setExpandedTablet] = useState<number | null>(null);

  const filterOpts = useMemo(
    () => ({ campaignId: campaignId || undefined, tabletId: tabletId || undefined }),
    [campaignId, tabletId],
  );

  // Rango que consumen los bloques dependientes del filtro de fechas.
  const fetchRange = (f: string, t: string, opts: { campaignId?: number; tabletId?: number }) => {
    setLoadingRange(true);
    Promise.allSettled([
      api.getRangeStats(f, t, opts),
      api.getDailyStats(f, t, opts),
      api.getHeatmap(f, t, opts),
      api.getHeatmapByDay(f, t, opts),
      api.getCompletionRate(f, t),
      api.getPlaylistStats(f, t),
      api.getPlaysByTabletAd(f, t),
    ]).then(([r, d, h, hd, c, p, ta]) => {
      if (r.status === 'fulfilled') setRange(r.value);
      if (d.status === 'fulfilled') setDaily(d.value);
      if (h.status === 'fulfilled') setHeatmap(h.value);
      if (hd.status === 'fulfilled') setHeatmapByDay(hd.value);
      if (c.status === 'fulfilled') setCompletion(c.value);
      if (p.status === 'fulfilled') setPlaylists(p.value);
      if (ta.status === 'fulfilled') setTabletAdPlays(ta.value);
    }).finally(() => setLoadingRange(false));
  };

  const loadStatic = () => {
    api.getCampaigns().then(setCampaigns).catch(() => {});
    api.getTablets().then(setTablets).catch(() => {});
    api.getWeeklyStats(8).then(setWeekly).catch(() => {});
    api.getMonthlyStats().then(setMonthly).catch(() => {});
    api.getAdsNoPlays().then(setAdsNoPlays).catch(() => {});
    api.getZoneStats().then(setZoneStats).catch(() => {});
    api.getSyncIntervals().then(setSyncIntervals).catch(() => {});
    api.getZoneHourStats().then(setZoneHour).catch(() => {});
    api.getSlaStats().then(setSlaStats).catch(() => {});
    api.getTabletMonitor().then(setMonitor).catch(() => {});
  };

  useEffect(() => {
    loadStatic();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load on mount
    fetchRange(from, to, filterOpts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = () => fetchRange(from, to, filterOpts);
  const refreshAll = async () => {
    setRefreshing(true);
    loadStatic();
    fetchRange(from, to, filterOpts);
    setTimeout(() => setRefreshing(false), 600);
  };

  // Preset de rango — setea from/to y recarga en el acto.
  const applyPreset = (key: 'today' | '7d' | 'month' | '30d' | '90d') => {
    const now = new Date();
    const t = now.getTime();
    let f = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (key === '7d') f = new Date(t - 6 * 86400000);
    else if (key === 'month') f = firstOfMonth(now);
    else if (key === '30d') f = new Date(t - 29 * 86400000);
    else if (key === '90d') f = new Date(t - 89 * 86400000);
    const nf2 = toInputDate(f);
    const nt = toInputDate(now);
    setFrom(nf2); setTo(nt);
    fetchRange(nf2, nt, filterOpts);
  };

  const onCampaign = (v: string) => {
    const id = v ? Number(v) : '';
    setCampaignId(id);
    fetchRange(from, to, { campaignId: id || undefined, tabletId: tabletId || undefined });
  };
  const onTablet = (v: string) => {
    const id = v ? Number(v) : '';
    setTabletId(id);
    fetchRange(from, to, { campaignId: campaignId || undefined, tabletId: id || undefined });
  };

  const filterLabel = [
    campaignId ? `campaña "${campaigns.find((c) => c.id === campaignId)?.name ?? campaignId}"` : null,
    tabletId ? `tablet "${tablets.find((t) => t.id === tabletId)?.name ?? tabletId}"` : null,
  ].filter(Boolean).join(' · ');

  // ── Derivados ────────────────────────────────────────────────────────────
  const rangeDays = daysBetween(from, to);
  const totalImpr = range?.totalPlays ?? 0;
  const avgDaily = Math.round(totalImpr / rangeDays);
  const complTotal = completion.reduce((s, c) => s + c.totalPlays, 0);
  const complDone = completion.reduce((s, c) => s + c.completedPlays, 0);
  const completionPct = complTotal > 0 ? Math.round((complDone / complTotal) * 100) : null;
  const avgCoverage = slaStats.length ? Math.round(slaStats.reduce((s, x) => s + x.coveragePct, 0) / slaStats.length) : null;

  const fleetTotal = monitor.length;
  const fleetOnline = monitor.filter((m) => m.status === 'online').length;
  const fleetOnlinePct = fleetTotal ? Math.round((fleetOnline / fleetTotal) * 100) : null;
  const lowBattery = monitor.filter((m) => m.batteryLevel != null && m.batteryLevel <= 20).length;

  // Trend: normalizo día/semana/mes a la misma forma para el mismo componente.
  const trend = useMemo(() => {
    if (trendMode === 'day') {
      return daily.map((d) => {
        const dt = new Date(d.date + 'T00:00:00');
        return { key: d.date, label: String(dt.getDate()), value: d.count, tip: dt.toLocaleDateString('es-UY', { weekday: 'short', day: '2-digit', month: 'short' }) };
      });
    }
    if (trendMode === 'week') {
      return weekly.map((w) => ({ key: w.week, label: w.from.slice(5), value: w.count, tip: `${w.from} → ${w.to}` }));
    }
    return monthly.map((m) => {
      const dt = new Date(m.month + '-01T00:00:00');
      return { key: m.month, label: dt.toLocaleDateString('es-UY', { month: 'short' }), value: m.count, tip: dt.toLocaleDateString('es-UY', { month: 'long', year: 'numeric' }) };
    });
  }, [trendMode, daily, weekly, monthly]);

  const trendTotal = trend.reduce((s, x) => s + x.value, 0);
  const trendAvg = trend.length ? Math.round(trendTotal / trend.length) : 0;
  const trendBest = trend.reduce<{ label: string; value: number } | null>((b, x) => (!b || x.value > b.value ? { label: x.tip, value: x.value } : b), null);
  const trendDelta = (() => {
    const nz = trend.filter((x) => x.value > 0);
    if (nz.length < 2) return null;
    const last = nz[nz.length - 1].value;
    const prev = nz[nz.length - 2].value;
    if (prev === 0) return null;
    return Math.round(((last - prev) / prev) * 100);
  })();
  const trendUnit = trendMode === 'day' ? 'día' : trendMode === 'week' ? 'semana' : 'mes';

  // Hora del día
  const hourlyTotal = heatmap.reduce((s, h) => s + h.count, 0);
  const hourlyPeak = heatmap.reduce<{ hour: number; count: number } | null>((b, h) => (!b || h.count > b.count ? h : b), null);
  const activeWindow = (() => {
    const nz = heatmap.filter((h) => h.count > 0).map((h) => h.hour);
    return nz.length ? `${Math.min(...nz)}:00–${Math.max(...nz)}:59` : '—';
  })();

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Estadísticas</h1>
        <RefreshButton onClick={refreshAll} loading={refreshing} />
      </div>

      {/* ══ Filtros ══ */}
      <div className="card p-4 mb-6 sticky top-0 z-10" style={{ background: 'var(--card)' }}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-1">
            {([['today', 'Hoy'], ['7d', '7 días'], ['month', 'Este mes'], ['30d', '30 días'], ['90d', '90 días']] as const).map(([k, lbl]) => (
              <button key={k} onClick={() => applyPreset(k)}
                className="text-xs px-2.5 py-1.5 rounded-lg border font-medium hover:bg-blue-50 dark:hover:bg-blue-950"
                style={{ borderColor: 'var(--border-md)', color: 'var(--text-muted)' }}>
                {lbl}
              </button>
            ))}
          </div>
          <div>
            <label className="block text-[11px] mb-0.5" style={{ color: 'var(--text-muted)' }}>Desde</label>
            <input type="date" className="input w-36" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-[11px] mb-0.5" style={{ color: 'var(--text-muted)' }}>Hasta</label>
            <input type="date" className="input w-36" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="block text-[11px] mb-0.5" style={{ color: 'var(--text-muted)' }}>Campaña</label>
            <select className="input w-44" value={campaignId} onChange={(e) => onCampaign(e.target.value)}>
              <option value="">Todas</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] mb-0.5" style={{ color: 'var(--text-muted)' }}>Tablet</label>
            <select className="input w-40" value={tabletId} onChange={(e) => onTablet(e.target.value)}>
              <option value="">Todas</option>
              {tablets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <button onClick={applyFilters} disabled={loadingRange}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg text-sm font-medium">
            {loadingRange ? 'Buscando…' : 'Aplicar'}
          </button>
        </div>
        <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
          Rango: <b>{from}</b> → <b>{to}</b> ({rangeDays} días){filterLabel ? ` · Filtrado por ${filterLabel}` : ''}
        </p>
      </div>

      {/* ══ Resumen ejecutivo ══ */}
      <div className="card p-6 mb-6">
        <h2 className="font-semibold mb-4">Resumen ejecutivo</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <Kpi label="Impresiones (rango)" value={nf(totalImpr)}
            tip={<>Cada vez que un anuncio se mostró en una tablet dentro del rango{filterLabel ? ` y filtros (${filterLabel})` : ''}. <b>Fuente:</b> tabla <code>metrics</code> (una fila por reproducción), <code>/api/stats/range</code>.</>} />
          <Kpi label={`Promedio / día`} value={nf(avgDaily)}
            tip={<>Impresiones ÷ días del rango. Base para proyectar volumen.</>} />
          <Kpi label="Campañas con actividad" value={range?.playsByCampaign.length ?? 0}
            tip={<>Campañas con al menos una impresión en el rango.</>} />
          <Kpi label="Tasa de finalización" value={completionPct == null ? '—' : `${completionPct}%`}
            good={completionPct != null && completionPct >= 80}
            tip={<>% de reproducciones que llegaron al final. <b>Fuente:</b> campo <code>completed</code> de <code>metrics</code>. No filtra por campaña/tablet.</>} />
          <Kpi label="Cobertura de flota (30d)" value={avgCoverage == null ? '—' : `${avgCoverage}%`}
            good={avgCoverage != null && avgCoverage >= 85}
            tip={<>Promedio de % de días del último mes en que cada tablet sincronizó. <b>Fuente:</b> <code>sync_logs</code>, <code>/api/stats/sla</code>.</>} />
        </div>
      </div>

      {/* ══ Tendencia (día / semana / mes) ══ */}
      <div className="card p-6 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h2 className="font-semibold">
            Reproducciones — tendencia
            <InfoTip>
              <b>Día:</b> reproducciones por día del mes actual (respeta los filtros de campaña/tablet).{' '}
              <b>Semana:</b> últimas 8 semanas. <b>Mes:</b> últimos 12 meses. Semana y mes son totales de toda la flota.{' '}
              <b>Fuente:</b> <code>metrics.played_at</code> agrupado por fecha local (America/Montevideo).
            </InfoTip>
          </h2>
          <div className="flex rounded-lg border overflow-hidden text-xs font-medium" style={{ borderColor: 'var(--border-md)' }}>
            {([['day', `Día · ${new Date().toLocaleDateString('es-UY', { month: 'long' })}`], ['week', 'Semana · 8'], ['month', 'Mes · 12']] as const).map(([k, lbl]) => (
              <button key={k} onClick={() => setTrendMode(k)}
                className={`px-3 py-1.5 ${trendMode === k ? 'bg-blue-600 text-white' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                style={trendMode === k ? undefined : { color: 'var(--text-muted)' }}>
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm mb-4">
          <Stat label="Total" value={nf(trendTotal)} />
          <Stat label={`Promedio / ${trendUnit}`} value={nf(trendAvg)} />
          {trendBest && trendBest.value > 0 && <Stat label={`Mejor ${trendUnit}`} value={`${nf(trendBest.value)}`} sub={trendBest.label} />}
          {trendDelta != null && (
            <Stat label={`Último ${trendUnit} vs anterior`}
              value={`${trendDelta >= 0 ? '+' : ''}${trendDelta}%`}
              valueClass={trendDelta >= 0 ? 'text-emerald-600' : 'text-red-500'} />
          )}
        </div>

        {trendMode !== 'day' && filterLabel && (
          <p className="text-[11px] mb-2 text-amber-500">La vista {trendUnit === 'semana' ? 'semanal' : 'mensual'} no filtra por campaña/tablet.</p>
        )}

        <BarChart data={trend} loading={loadingRange && trendMode === 'day'} />
      </div>

      {/* ══ Reproducciones por hora del día ══ */}
      <div className="card p-6 mb-6">
        <h2 className="font-semibold mb-1">Reproducciones por hora del día</h2>
        <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
          Suma de todas las reproducciones del rango, agrupadas por la hora local (America/Montevideo) en que ocurrieron.{' '}
          <b>Fuente:</b> <code>metrics.played_at</code> · <code>/api/stats/heatmap</code>. Rango {from} → {to}{filterLabel ? ` · ${filterLabel}` : ''}.
        </p>

        <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm mb-4">
          <Stat label="Total en el rango" value={nf(hourlyTotal)} />
          {hourlyPeak && hourlyPeak.count > 0 && (
            <Stat label="Hora pico" value={`${hourlyPeak.hour}:00`}
              sub={`${nf(hourlyPeak.count)} · ${Math.round((hourlyPeak.count / (hourlyTotal || 1)) * 100)}% del total`} />
          )}
          <Stat label="Franja activa" value={activeWindow} />
        </div>

        {hourlyTotal === 0 ? (
          <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>Sin reproducciones en el rango.</p>
        ) : (
          <div className="flex items-end gap-1 h-32">
            {heatmap.map((h) => {
              const maxH = Math.max(...heatmap.map((x) => x.count), 1);
              const pct = (h.count / maxH) * 100;
              return (
                <div key={h.hour} className="flex-1 flex flex-col items-center gap-1 group" title={`${h.hour}:00 — ${nf(h.count)} reproducciones`}>
                  <span className="text-[9px] tabular-nums opacity-0 group-hover:opacity-100" style={{ color: 'var(--text-muted)' }}>{h.count || ''}</span>
                  <div className="w-full flex flex-col justify-end" style={{ height: '84px' }}>
                    <div className="w-full rounded-t transition-all" style={{ height: `${Math.max(pct, h.count > 0 ? 4 : 0)}%`, background: ACCENT, opacity: 0.35 + 0.65 * (h.count / maxH) }} />
                  </div>
                  <span className="text-[9px] tabular-nums" style={{ color: 'var(--text-xs)' }}>{h.hour}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ══ Mapa de calor: día × hora ══ */}
      <HeatmapDayHour rows={heatmapByDay} loading={loadingRange} from={from} to={to} filterLabel={filterLabel} />

      {/* ══ Rendimiento por playlist ══ */}
      {playlists.length > 0 && (
        <div className="card p-6 mb-6">
          <h2 className="font-semibold mb-1">Rendimiento por playlist</h2>
          <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
            Reproducciones por playlist en el rango. <b>Fuente:</b> <code>/api/stats/playlists</code>.
          </p>
          {(() => {
            const maxPlays = Math.max(...playlists.map((p) => p.totalPlays), 1);
            return (
              <div className="space-y-3">
                {playlists.map((p) => (
                  <div key={p.playlistId}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium truncate max-w-[60%]">{p.playlistName}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{nf(p.totalPlays)} reprod. · {p.tabletCount} tablet{p.tabletCount !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="w-full h-2 rounded-full" style={{ background: 'var(--border-md)' }}>
                      <div className="h-2 rounded-full transition-all" style={{ width: `${Math.max((p.totalPlays / maxPlays) * 100, p.totalPlays > 0 ? 2 : 0)}%`, background: ACCENT }} />
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* ══ Desglose del rango ══ */}
      <div className="card p-6 mb-6">
        <h2 className="font-semibold mb-4">Desglose del rango</h2>
        {!range ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargando…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              {[
                { label: 'Total reproducciones', value: nf(range.totalPlays) },
                { label: 'Campañas', value: range.playsByCampaign.length },
                { label: 'Tablets', value: range.playsByTablet.length },
                { label: 'Días con actividad', value: range.dailyPlays.filter((d) => d.count > 0).length },
              ].map((s) => (
                <div key={s.label} className="rounded-lg p-4" style={{ background: 'var(--bg)' }}>
                  <p className="text-2xl font-bold tabular-nums">{s.value}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <RankTable title="Top campañas" rows={range.playsByCampaign.map((c) => ({ id: c.campaignId, name: c.campaignName, count: c.count }))} />
              <RankTable title="Top tablets" rows={range.playsByTablet.map((t) => ({ id: t.tabletId, name: t.tabletName, count: t.count }))} />
              <div className="lg:col-span-2">
                <RankTable title="Top 10 anuncios más reproducidos" rows={(range.playsByAd ?? []).map((a) => ({ id: a.adId, name: a.adName, count: a.count }))} />
              </div>
            </div>

            <div className="mt-6">
              <p className="text-sm font-medium mb-3">Reproducciones por tablet (qué anuncios y cuántas veces)</p>
              {tabletAdPlays.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sin datos.</p>
              ) : (
                <div className="space-y-1.5">
                  {Object.values(
                    tabletAdPlays.reduce((acc, row) => {
                      (acc[row.tabletId] ||= { tabletId: row.tabletId, tabletName: row.tabletName, total: 0, ads: [] }).total += row.count;
                      acc[row.tabletId].ads.push({ adId: row.adId, adName: row.adName, count: row.count });
                      return acc;
                    }, {} as Record<number, { tabletId: number; tabletName: string; total: number; ads: { adId: number; adName: string; count: number }[] }>),
                  )
                    .sort((a, b) => b.total - a.total)
                    .map((tg) => {
                      const open = expandedTablet === tg.tabletId;
                      return (
                        <div key={tg.tabletId} className="rounded-lg border" style={{ borderColor: 'var(--border-md)' }}>
                          <button onClick={() => setExpandedTablet(open ? null : tg.tabletId)}
                            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800">
                            <span className="text-sm font-medium flex items-center gap-2">
                              <span className={`text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>{tg.tabletName}
                            </span>
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                              {nf(tg.total)} reproducciones · {tg.ads.length} anuncios distintos
                            </span>
                          </button>
                          {open && (
                            <table className="w-full text-sm border-t" style={{ borderColor: 'var(--border-md)' }}>
                              <tbody>
                                {tg.ads.sort((a, b) => b.count - a.count).map((a) => (
                                  <tr key={a.adId} className="border-t" style={{ borderColor: 'var(--border)' }}>
                                    <td className="py-1.5 px-3 truncate max-w-[300px]">{a.adName}</td>
                                    <td className="py-1.5 px-3 text-right font-medium tabular-nums" style={{ color: 'var(--text-muted)' }}>{nf(a.count)}</td>
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

            {completion.length > 0 && (
              <div className="mt-6">
                <p className="text-sm font-medium mb-3">Tasa de finalización por anuncio</p>
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
                        <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{nf(c.totalPlays)}</td>
                        <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{nf(c.completedPlays)}</td>
                        <td className="py-1.5 text-right">
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${c.completionRate >= 80 ? 'bg-emerald-100 text-emerald-700' : c.completionRate >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-600'}`}>
                            {c.completionRate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* ══ Salud de la flota ══ */}
      {fleetTotal > 0 && (
        <div className="card p-6 mb-6">
          <h2 className="font-semibold mb-4">Salud de la flota
            <InfoTip><b>Fuente:</b> <code>/api/tablets/monitor</code>, actualizado en cada sync de cada tablet.</InfoTip>
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Kpi label="Online ahora" value={fleetOnlinePct == null ? '—' : `${fleetOnlinePct}%`} sub={`${fleetOnline}/${fleetTotal}`}
              good={fleetOnlinePct != null && fleetOnlinePct >= 90} tip={<>Tablets que sincronizaron en los últimos 10 minutos.</>} />
            <Kpi label="Batería baja (≤20%)" value={lowBattery} good={lowBattery === 0}
              tip={<>Tablets con batería crítica. En un taxi con cargador no debería pasar.</>} />
            <Kpi label="Tablets con reproducciones" value={new Set((range?.playsByTablet ?? []).map((t) => t.tabletId)).size}
              tip={<>Tablets que reprodujeron al menos un anuncio en el rango.</>} />
            <Kpi label="Playlists activas" value={playlists.length} tip={<>Playlists con reproducciones en el rango.</>} />
          </div>
        </div>
      )}

      {/* ══ Rendimiento por zona ══ */}
      {zoneStats.length > 0 && (
        <div className="card p-6 mb-6">
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
                  const perTablet = z.tablets > 0 ? Math.round(z.plays / z.tablets) : 0;
                  const maxPlays = Math.max(...zoneStats.map((s) => s.plays), 1);
                  return (
                    <tr key={z.zone} className="border-t" style={{ borderColor: 'var(--border-md)' }}>
                      <td className="py-2.5 font-medium">{z.zone}</td>
                      <td className="py-2.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{z.tablets}</td>
                      <td className="py-2.5 text-right">
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${z.online > 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'}`}>{z.online}</span>
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 rounded-full" style={{ background: 'var(--border-md)' }}>
                            <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${Math.round((z.plays / maxPlays) * 100)}%` }} />
                          </div>
                          <span className="tabular-nums font-medium">{nf(z.plays)}</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{nf(perTablet)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ Zona × hora ══ */}
      {zoneHour.length > 0 && (() => {
        const zones = [...new Set(zoneHour.map((r) => r.zone))].sort();
        const hours = Array.from({ length: 24 }, (_, i) => i);
        const maxCount = Math.max(...zoneHour.map((r) => r.count), 1);
        const lookup = new Map(zoneHour.map((r) => [`${r.zone}:${r.hour}`, r.count]));
        return (
          <div className="card p-6 mb-6">
            <h2 className="font-semibold mb-1">Reproducciones por zona y hora (últimos 30 días)</h2>
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>Hora local. Azul más intenso = más reproducciones. <b>Fuente:</b> <code>/api/stats/zone-hour</code>.</p>
            <div className="overflow-x-auto">
              <table className="text-xs w-full">
                <thead>
                  <tr>
                    <th className="text-left pb-2 pr-3 font-medium" style={{ color: 'var(--text-muted)', minWidth: '100px' }}>Zona</th>
                    {hours.map((h) => <th key={h} className="text-center pb-2 px-0.5 font-medium tabular-nums" style={{ color: 'var(--text-muted)', minWidth: '20px' }}>{h % 3 === 0 ? h : ''}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {zones.map((zone) => (
                    <tr key={zone}>
                      <td className="pr-3 py-1 font-medium truncate max-w-[100px]" title={zone}>{zone}</td>
                      {hours.map((h) => {
                        const count = lookup.get(`${zone}:${h}`) ?? 0;
                        return (
                          <td key={h} className="px-0.5 py-1 text-center" title={`${zone} ${h}:00 — ${count}`}>
                            <div className="mx-auto rounded" style={{ width: '16px', height: '16px', background: count === 0 ? 'var(--border)' : `rgba(59,130,246,${0.15 + (count / maxCount) * 0.85})` }} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ══ Intervalos de sync ══ */}
      {syncIntervals.length > 0 && (
        <div className="card p-6 mb-6">
          <h2 className="font-semibold mb-4">Intervalos de sincronización (últimos 7 días)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  <th className="text-left pb-2">Tablet</th><th className="text-left pb-2">Zona</th>
                  <th className="text-right pb-2">Syncs</th><th className="text-right pb-2">Promedio entre syncs</th>
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
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${s.avgMinutes <= 6 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : s.avgMinutes <= 15 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}`}>{s.avgMinutes} min</span>
                      ) : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ SLA ══ */}
      {slaStats.length > 0 && (
        <div className="card p-6 mb-6">
          <h2 className="font-semibold mb-4">Cumplimiento SLA por tablet (últimos 30 días)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  <th className="text-left pb-2">Tablet</th><th className="text-left pb-2">Zona</th>
                  <th className="text-right pb-2">Días activos</th><th className="text-right pb-2">Syncs 30d</th><th className="text-right pb-2">Cobertura</th>
                </tr>
              </thead>
              <tbody>
                {slaStats.map((s) => (
                  <tr key={s.tabletId} className="border-t" style={{ borderColor: 'var(--border-md)' }}>
                    <td className="py-2.5 font-medium">{s.tabletName}</td>
                    <td className="py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{s.zone ?? '—'}</td>
                    <td className="py-2.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{s.activeDays30d} / 30</td>
                    <td className="py-2.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{nf(s.syncCount30d)}</td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 rounded-full" style={{ background: 'var(--border-md)' }}>
                          <div className={`h-1.5 rounded-full ${s.coveragePct >= 90 ? 'bg-emerald-500' : s.coveragePct >= 60 ? 'bg-amber-400' : 'bg-red-500'}`} style={{ width: `${s.coveragePct}%` }} />
                        </div>
                        <span className={`text-xs font-medium tabular-nums ${s.coveragePct >= 90 ? 'text-emerald-600' : s.coveragePct >= 60 ? 'text-amber-500' : 'text-red-500'}`}>{s.coveragePct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ Anuncios sin reproducciones ══ */}
      {adsNoPlays.length > 0 && (
        <div className="card p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Anuncios sin reproducciones</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
              {adsNoPlays.length} anuncio{adsNoPlays.length !== 1 ? 's' : ''}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                <th className="text-left pb-2">Anuncio</th><th className="text-left pb-2">Tipo</th><th className="text-left pb-2">Campaña</th>
                <th className="text-right pb-2">Duración</th><th className="text-right pb-2">Creado</th>
              </tr>
            </thead>
            <tbody>
              {adsNoPlays.map((a) => (
                <tr key={a.id} className="border-t" style={{ borderColor: 'var(--border-md)' }}>
                  <td className="py-2 font-medium max-w-[180px] truncate">{a.name}</td>
                  <td className="py-2"><span className={`text-xs px-1.5 py-0.5 rounded-full ${a.type === 'video' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>{a.type}</span></td>
                  <td className="py-2 max-w-[180px] truncate" style={{ color: 'var(--text-muted)' }}>
                    {a.campaign.name}{!a.campaign.active && <span className="ml-1 text-xs text-gray-400">(pausada)</span>}
                  </td>
                  <td className="py-2 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{a.durationS}s</td>
                  <td className="py-2 text-right text-xs" style={{ color: 'var(--text-xs)' }}>{new Date(a.createdAt).toLocaleDateString('es-UY')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Componentes ────────────────────────────────────────────────────────────

function BarChart({ data, loading }: { data: { key: string; label: string; value: number; tip: string }[]; loading?: boolean }) {
  if (loading) return <p className="text-sm py-10 text-center" style={{ color: 'var(--text-muted)' }}>Cargando…</p>;
  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return <p className="text-sm py-10 text-center" style={{ color: 'var(--text-muted)' }}>Sin reproducciones en este período.</p>;
  }
  const max = Math.max(...data.map((d) => d.value), 1);
  const showEvery = data.length > 20 ? Math.ceil(data.length / 15) : 1;
  return (
    <div className="flex items-end gap-1 h-52">
      {data.map((d, i) => {
        const pct = (d.value / max) * 100;
        return (
          <div key={d.key} className="flex-1 flex flex-col items-center gap-1 group min-w-0" title={`${d.tip}: ${nf(d.value)}`}>
            <span className="text-[10px] font-medium tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {d.value > 0 ? nf(d.value) : ''}
            </span>
            <div className="w-full flex flex-col justify-end" style={{ height: '150px' }}>
              <div className="w-full rounded-t-md transition-all group-hover:brightness-110"
                style={{ height: `${Math.max(pct, d.value > 0 ? 3 : 0)}%`, background: ACCENT, opacity: 0.4 + 0.6 * (d.value / max) }} />
            </div>
            <span className="text-[10px] text-center tabular-nums truncate w-full" style={{ color: 'var(--text-xs)' }}>
              {i % showEvery === 0 ? d.label : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function HeatmapDayHour({ rows, loading, from, to, filterLabel }: {
  rows: DayHourCount[]; loading: boolean; from: string; to: string; filterLabel: string;
}) {
  const days = useMemo(() => [...new Set(rows.map((r) => r.date))].sort().slice(-45), [rows]);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const lookup = useMemo(() => new Map(rows.map((r) => [`${r.date}:${r.hour}`, r.count])), [rows]);
  const max = Math.max(...rows.map((r) => r.count), 1);
  const dayTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.date, (m.get(r.date) ?? 0) + r.count);
    return m;
  }, [rows]);
  const hourTotals = hours.map((h) => rows.filter((r) => r.hour === h).reduce((s, r) => s + r.count, 0));
  const maxHourTotal = Math.max(...hourTotals, 1);

  return (
    <div className="card p-6 mb-6">
      <h2 className="font-semibold mb-1">Mapa de calor — día × hora</h2>
      <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
        Cada fila es un día; cada columna, una hora local. Cuanto más intenso el azul, más reproducciones hubo en esa hora ese día — sirve para ver
        a qué días y a qué horas sale más publicidad. <b>Fuente:</b> <code>metrics.played_at</code> · <code>/api/stats/heatmap-by-day</code>.
        Rango {from} → {to}{filterLabel ? ` · ${filterLabel}` : ''}.
      </p>

      {loading ? (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>Cargando…</p>
      ) : days.length === 0 ? (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>Sin reproducciones en el rango.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="text-left pb-1 pr-2 font-medium sticky left-0" style={{ color: 'var(--text-muted)', background: 'var(--card)' }}>Día</th>
                  {hours.map((h) => (
                    <th key={h} className="pb-1 px-0 font-medium tabular-nums text-center" style={{ color: 'var(--text-muted)', width: '20px' }}>
                      {h % 3 === 0 ? h : ''}
                    </th>
                  ))}
                  <th className="text-right pb-1 pl-3 font-medium" style={{ color: 'var(--text-muted)' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {days.map((date) => {
                  const dt = new Date(date + 'T00:00:00');
                  return (
                    <tr key={date}>
                      <td className="pr-2 py-0.5 font-medium tabular-nums whitespace-nowrap sticky left-0" style={{ background: 'var(--card)' }}>
                        {dt.toLocaleDateString('es-UY', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                      </td>
                      {hours.map((h) => {
                        const count = lookup.get(`${date}:${h}`) ?? 0;
                        return (
                          <td key={h} className="px-0 py-0.5 text-center" title={`${dt.toLocaleDateString('es-UY')} · ${h}:00 — ${nf(count)} reproducciones`}>
                            <div className="mx-auto rounded-sm" style={{ width: '17px', height: '17px', background: count === 0 ? 'var(--border)' : `rgba(59,130,246,${0.12 + (count / max) * 0.88})` }} />
                          </td>
                        );
                      })}
                      <td className="text-right pl-3 py-0.5 font-medium tabular-nums">{nf(dayTotals.get(date) ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="pr-2 pt-1 font-medium sticky left-0" style={{ color: 'var(--text-muted)', background: 'var(--card)' }}>Por hora</td>
                  {hours.map((h) => (
                    <td key={h} className="px-0 pt-1 align-bottom">
                      <div className="mx-auto w-[13px] rounded-t" style={{ height: `${Math.max((hourTotals[h] / maxHourTotal) * 28, hourTotals[h] > 0 ? 2 : 0)}px`, background: ACCENT, opacity: 0.55 }} title={`${h}:00 — ${nf(hourTotals[h])} en total`} />
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex items-center gap-2 mt-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            <span>menos</span>
            <div className="flex gap-0.5">
              {[0.12, 0.35, 0.55, 0.75, 1].map((o) => (
                <div key={o} className="rounded-sm" style={{ width: '16px', height: '12px', background: `rgba(59,130,246,${o})` }} />
              ))}
            </div>
            <span>más ({nf(max)} máx. en una hora)</span>
          </div>
        </>
      )}
    </div>
  );
}

function RankTable({ title, rows }: { title: string; rows: { id: number; name: string; count: number }[] }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div>
      <p className="text-sm font-medium mb-3">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sin datos.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="border-t" style={{ borderColor: 'var(--border-md)' }}>
                <td className="py-1.5 pr-2 font-bold text-xs w-5" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                <td className="py-1.5 truncate max-w-[220px]">{r.name}</td>
                <td className="py-1.5 w-24">
                  <div className="h-1.5 rounded-full" style={{ background: 'var(--border-md)' }}>
                    <div className="h-1.5 rounded-full" style={{ width: `${(r.count / max) * 100}%`, background: ACCENT }} />
                  </div>
                </td>
                <td className="py-1.5 text-right font-medium tabular-nums w-16">{nf(r.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Stat({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div>
      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className={`text-lg font-bold tabular-nums ${valueClass ?? ''}`}>{value}</p>
      {sub && <p className="text-[11px] -mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );
}

function Kpi({ label, value, sub, tip, good }: {
  label: string; value: React.ReactNode; sub?: string; tip?: React.ReactNode; good?: boolean;
}) {
  return (
    <div>
      <p className="text-xs mb-1 flex items-center" style={{ color: 'var(--text-muted)' }}>
        {label}{tip && <InfoTip>{tip}</InfoTip>}
      </p>
      <p className={`text-2xl font-bold tabular-nums ${good === true ? 'text-emerald-600' : good === false ? 'text-amber-500' : ''}`}>
        {value}{sub && <span className="text-sm font-normal ml-1" style={{ color: 'var(--text-muted)' }}>{sub}</span>}
      </p>
    </div>
  );
}
