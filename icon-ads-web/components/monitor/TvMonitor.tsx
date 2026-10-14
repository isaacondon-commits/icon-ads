'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BandwidthStatus, TabletMonitorEntry } from '@/lib/api';
import ScreenshotViewer from '@/components/ScreenshotViewer';
import FilterBar from '@/components/FilterBar';
import { applyFilter, type Filter } from '@/lib/filterEngine';
import { monitorFilterConfig } from '@/lib/monitorFilters';

const LS_MONITOR_FILTERS = 'monitor_filters_v1';

// Monitor con la paleta "ICON" (clase .ia-theme en globals.css, tomada de
// paleta-propuesta.png): barra superior, barra de controles de la flota y la
// lista de tablets (pestañas con alertas, una fila por tablet con todas sus
// acciones). Independiente del tema claro/oscuro del resto del panel.

export type TvActions = {
  wake: (id: number) => void; wakingId: number | null;
  forceSync: (id: number) => void; syncingId: number | null;
  toggleBlock: (t: TabletMonitorEntry) => void; blockingId: number | null;
  remove: (t: TabletMonitorEntry) => void;
};

export type TvFleet = {
  // Ex página "Tablets": sincronizar todas, exportar CSV y alta manual.
  syncingAll: boolean; onSyncAll: () => void;
  onExportCsv: () => void;
  onCreate?: () => void;
  allBlocked: boolean; blockingAll: boolean; onBlockAll: () => void;
  wakingAll: boolean; onWakeAll: () => void;
  brightAuto: boolean; brightPct: number; savingBright: boolean;
  setBrightPct: (n: number) => void; commitBrightness: (v: number | 'auto') => void;
  bw: BandwidthStatus | null; togglingFreeze: boolean; onFreezeToggle: () => void;
  resettingCircuit: boolean; onResetCircuit: () => void;
};

type Props = {
  entries: TabletMonitorEntry[];
  loading: boolean;
  error: string;
  countdown: number;
  onRefresh: () => void;
  canManage: boolean;
  actions: TvActions;
  fleet: TvFleet;
};

function relativeTime(iso: string | null): string {
  if (!iso) return 'nunca';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `hace ${diff}s`;
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return `hace ${Math.floor(diff / 86400)} d`;
}

type Tone = 'ok' | 'bad' | 'blocked' | 'off' | 'idle';
function stateOf(e: TabletMonitorEntry): { label: string; tone: Tone } {
  if (e.health === 'blocked') return { label: 'Bloqueada', tone: 'blocked' };
  if (e.health === 'sin-playlist') return { label: 'Sin playlist', tone: 'bad' };
  if (e.health === 'no-reproduce') return { label: e.onFallback ? 'No cargó playlist' : 'No reproduce', tone: 'bad' };
  if (e.status === 'online') return { label: 'En línea', tone: 'ok' };
  if (e.offlineMinutes > 48 * 60) return { label: `Apagada hace ${Math.floor(e.offlineMinutes / 1440)} d`, tone: 'off' };
  if (e.offlineMinutes > 120) return { label: `Apagada hace ${Math.floor(e.offlineMinutes / 60)} h`, tone: 'off' };
  return { label: 'Fuera de línea', tone: 'idle' };
}

// Color del punto de estado (variables de la paleta).
const DOT: Record<Tone, string> = {
  ok: 'var(--ok)', bad: 'var(--danger)', blocked: 'var(--warn)', off: 'var(--danger)', idle: 'var(--muted-2)',
};

const ICONS = {
  power: 'M12 3v8M6.3 7.3a8 8 0 1 0 11.4 0',
  sync: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  unlock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  battery: 'M8 4h8v17H8zM10 2h4',
  warn: 'M12 4 2.5 20h19zM12 10v4M12 17h.01',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  plus: 'M12 5v14M5 12h14',
} as const;

function Ico({ d, className = 'h-4 w-4', style }: { d: string; className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

// Botones: base con borde + variantes de la imagen.
const pill = 'inline-flex items-center gap-2 h-10 px-4 rounded-full border text-sm font-medium whitespace-nowrap transition-colors disabled:opacity-40';
const V = {
  neutral: 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-hover)]',
  primary: 'border-[var(--accent-strong)] bg-[var(--accent-strong)] text-white hover:bg-[var(--accent-hover)] hover:border-[var(--accent-hover)]',
  danger: 'border-[var(--danger-border)] bg-transparent text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]',
  ok: 'border-[color-mix(in_srgb,var(--ok)_40%,transparent)] bg-[color-mix(in_srgb,var(--ok)_10%,transparent)] text-[var(--ok)] hover:bg-[color-mix(in_srgb,var(--ok)_18%,transparent)]',
} as const;

function Btn({ icon, v = 'neutral', onClick, disabled, title, children }: {
  icon: keyof typeof ICONS; v?: keyof typeof V; onClick: () => void; disabled?: boolean; title?: string; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className={`${pill} ${V[v]}`}>
      <Ico d={ICONS[icon]} />
      {children}
    </button>
  );
}

// Columnas de la lista: miniatura · tablet · conexión · repr. · playlist · equipo · acciones
const ROW_GRID = 'grid grid-cols-[72px_minmax(240px,1.5fr)_100px_70px_minmax(130px,1fr)_170px_336px] items-center gap-x-4';

const iconBtn = 'inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors disabled:opacity-40';

function IconBtn({ icon, label, v = 'neutral', onClick, disabled }: {
  icon: keyof typeof ICONS; label: string; v?: keyof typeof V; onClick: () => void; disabled?: boolean;
}) {
  return (
    <span className="group/ib relative">
      <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className={`${iconBtn} ${V[v]}`}>
        <Ico d={ICONS[icon]} />
      </button>
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-xs text-[var(--text)] shadow-lg group-hover/ib:block">
        {label}
      </span>
    </span>
  );
}

const chip = 'inline-flex items-center gap-1.5 h-10 px-4 rounded-full border border-[var(--border)] bg-[var(--surface)] text-sm';

function tabletNumber(name: string) {
  const m = name.match(/(\d+)\s*$/);
  return m ? m[1].padStart(2, '0') : name.slice(0, 2).toUpperCase();
}

function batteryColor(n: number) {
  return n <= 20 ? 'var(--danger)' : n <= 50 ? 'var(--warn)' : 'var(--ok)';
}

export default function TvMonitor({ entries, loading, error, countdown, onRefresh, canManage, actions, fleet }: Props) {
  const [search, setSearch] = useState('');
  // null en el primer render: el reloj sólo existe en el navegador (evita
  // diferencias de hidratación entre servidor y cliente).
  const [clock, setClock] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setClock(new Date());
    tick();
    const t = setInterval(tick, 15_000);
    return () => clearInterval(t);
  }, []);

  const online = entries.filter((e) => e.status === 'online').length;
  const totalPlays = entries.reduce((n, e) => n + e.todayPlays, 0);
  const bw = fleet.bw;

  return (
    <div className="ia-theme relative isolate -m-4 sm:-m-6 lg:-m-8 min-h-screen overflow-x-clip bg-[var(--bg)] text-[var(--text)]">
      <style>{`
        @keyframes ia-float { 0%,100% { transform: translateY(0) rotate(-3deg) } 50% { transform: translateY(-14px) rotate(2deg) } }
        @keyframes ia-glow { 0%,100% { opacity: .35 } 50% { opacity: .6 } }
        @media (prefers-reduced-motion: reduce) { .ia-anim { animation: none !important } }
      `}</style>
      {/* Tucán animado, detrás del texto arriba a la derecha */}
      <div aria-hidden="true" className="pointer-events-none absolute right-6 top-2 -z-10 hidden md:block">
        <div className="ia-anim absolute inset-6 rounded-full bg-[var(--accent-strong)] blur-3xl"
          style={{ animation: 'ia-glow 6s ease-in-out infinite' }} />
        <img src="/monitor/toucan.png" alt="" className="ia-anim relative w-[260px] opacity-35 lg:w-[300px]"
          style={{ animation: 'ia-float 7s ease-in-out infinite' }} />
      </div>
      <div className="px-6 pb-10 pt-5 sm:px-10">
        {/* Barra superior */}
        <header className="flex flex-wrap items-center gap-3">
          <div className="mr-3 flex items-center gap-3">
            <img src="/monitor/toucan.png" alt="" className="h-9 w-auto" />
            <div className="leading-tight">
              <p className="text-base font-bold tracking-wide text-[var(--accent)]">ICONADS</p>
              <p className="text-[11px] uppercase tracking-[0.25em] text-[var(--muted)]">Monitor en vivo</p>
            </div>
          </div>

          <span className={chip}>
            <b style={{ color: online === 0 ? 'var(--danger)' : 'var(--ok)' }}>{online}</b>
            <span className="text-[var(--text-2)]">de {entries.length} en línea</span>
          </span>
          <span className={chip}>
            <b>{totalPlays.toLocaleString('es-AR')}</b>
            <span className="text-[var(--text-2)]">reproducciones hoy</span>
          </span>
          {bw && (
            <span className={chip}>
              <span className="h-2 w-2 rounded-full" style={{ background: bw.frozen ? 'var(--accent)' : 'var(--ok)' }} />
              <span className="text-[var(--text-2)]">{bw.frozen ? 'Producción congelada' : 'Producción activa'}</span>
            </span>
          )}
          {bw?.circuitOpen && (
            <span className={`${chip} border-[var(--danger-border)] text-[var(--danger)]`}>Disyuntor abierto</span>
          )}

          <div className="ml-auto flex items-center gap-3">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar tablet, zona, taxista…"
              className="h-11 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-2)] focus:border-[var(--accent)]" />
            <button type="button" onClick={onRefresh} title="Actualizar ahora"
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 text-sm text-[var(--text)] hover:bg-[var(--surface-hover)]">
              <Ico d={ICONS.refresh} />
              <span className="tabular-nums">{countdown}s</span>
            </button>
            <div className="hidden text-right leading-tight sm:block">
              <p className="font-mono text-3xl tabular-nums">{clock?.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: false }) ?? '--:--'}</p>
              <p className="text-xs capitalize text-[var(--muted)]">{clock?.toLocaleDateString('es-UY', { weekday: 'long', day: 'numeric', month: 'short' }) ?? ''}</p>
            </div>
          </div>
        </header>

        {/* Controles de la flota */}
        {canManage && (
          <section className="mt-6 inline-flex max-w-full flex-wrap items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
            <span className="text-sm font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">Flota</span>
            <Ico d={ICONS.sun} className="h-5 w-5" style={{ color: 'var(--warn)' }} />
            <button type="button" onClick={() => fleet.commitBrightness('auto')} disabled={fleet.savingBright}
              className={`${pill} ${fleet.brightAuto ? V.primary : V.neutral}`}>
              Auto (solar)
            </button>
            <input type="range" min={5} max={100} step={5} value={fleet.brightPct} disabled={fleet.savingBright}
              onChange={(ev) => fleet.setBrightPct(Number(ev.target.value))}
              onPointerUp={() => fleet.commitBrightness(fleet.brightPct)}
              onKeyUp={(ev) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) fleet.commitBrightness(fleet.brightPct); }}
              className="w-48 accent-[var(--accent)]" aria-label="Brillo de la flota" />
            <span className="w-12 text-sm font-semibold tabular-nums" style={{ color: 'var(--warn)' }}>
              {fleet.brightAuto ? 'auto' : `${fleet.brightPct}%`}
            </span>
            <Btn icon="power" v="primary" onClick={fleet.onWakeAll} disabled={fleet.wakingAll}>
              {fleet.wakingAll ? 'Enviando…' : 'Prender todas'}
            </Btn>
            <Btn icon="sync" onClick={fleet.onSyncAll} disabled={fleet.syncingAll} title="Fuerza a todas las tablets a sincronizar ahora">
              {fleet.syncingAll ? 'Sincronizando…' : 'Sincronizar todas'}
            </Btn>
            <Btn icon={fleet.allBlocked ? 'unlock' : 'lock'} v={fleet.allBlocked ? 'ok' : 'neutral'} onClick={fleet.onBlockAll} disabled={fleet.blockingAll}>
              {fleet.blockingAll ? 'Aplicando…' : fleet.allBlocked ? 'Desbloquear todas' : 'Bloquear todas'}
            </Btn>
            {bw && (
              <Btn icon="lock" onClick={fleet.onFreezeToggle} disabled={fleet.togglingFreeze}
                title={bw.frozen ? 'Las tablets vuelven a poder descargar playlists' : 'Ninguna tablet descarga; siguen reproduciendo lo que tienen'}>
                {fleet.togglingFreeze ? '…' : bw.frozen ? 'Descongelar producción' : 'Congelar producción'}
              </Btn>
            )}
            {bw?.circuitOpen && (
              <Btn icon="refresh" v="danger" onClick={fleet.onResetCircuit} disabled={fleet.resettingCircuit}>
                {fleet.resettingCircuit ? 'Reseteando…' : 'Resetear disyuntor'}
              </Btn>
            )}
          </section>
        )}

        {loading ? (
          <p className="mt-8 text-[var(--muted)]">Cargando flota…</p>
        ) : error ? (
          <p className="mt-8 text-[var(--danger)]">{error}</p>
        ) : entries.length === 0 ? (
          <p className="mt-8 text-[var(--muted)]">No hay tablets registradas.</p>
        ) : (
          <FleetList entries={entries} search={search} canManage={canManage} actions={actions}
            onExportCsv={fleet.onExportCsv} onCreate={fleet.onCreate} />
        )}
      </div>
    </div>
  );
}

// ── Lista de la flota ────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

const isLongOffline = (e: TabletMonitorEntry) => e.status === 'offline' && e.offlineMinutes > 120;

// Pestañas: las "alert" sólo aparecen (en rojo) si tienen algo, y al pasar el
// mouse muestran el detalle.
const TABS = [
  { id: 'all', label: 'Todas', match: () => true },
  { id: 'online', label: 'En línea', match: (e: TabletMonitorEntry) => e.status === 'online' },
  { id: 'offline', label: 'Fuera de línea', match: (e: TabletMonitorEntry) => e.status === 'offline' },
  { id: 'notplaying', label: 'No reproducen', match: (e: TabletMonitorEntry) => e.health === 'no-reproduce' || e.health === 'sin-playlist', alert: true },
  { id: 'blocked', label: 'Bloqueadas', match: (e: TabletMonitorEntry) => e.health === 'blocked', alert: true },
  { id: 'lowbat', label: 'Batería baja', match: (e: TabletMonitorEntry) => e.status === 'online' && e.batteryLevel != null && e.batteryLevel <= 20, alert: true },
  { id: 'longoffline', label: 'Apagadas +2 h', match: isLongOffline, alert: true },
] as const;
type TabId = typeof TABS[number]['id'];

const TAB_TIPS: Record<string, { title: (n: number) => string; hint: string; line: (e: TabletMonitorEntry) => string }> = {
  notplaying: {
    title: (n) => `${n} ${n === 1 ? 'tablet en línea NO muestra' : 'tablets en línea NO muestran'} publicidad`,
    hint: 'Tocá "Ver pantalla" para ver qué está pasando.',
    line: (e) => `${e.name} — ${stateOf(e).label.toLowerCase()}`,
  },
  blocked: {
    title: (n) => `${n} ${n === 1 ? 'tablet bloqueada' : 'tablets bloqueadas'} desde el panel`,
    hint: 'No muestran publicidad a propósito. Se desbloquean desde su fila.',
    line: (e) => e.name,
  },
  lowbat: {
    title: (n) => `${n} ${n === 1 ? 'tablet' : 'tablets'} con batería baja`,
    hint: 'Hablá con el taxista para que la enchufe.',
    line: (e) => [e.name, `${e.batteryLevel}%`, e.driverName, e.licensePlate].filter(Boolean).join(' · '),
  },
  longoffline: {
    title: (n) => `${n} ${n === 1 ? 'tablet apagada' : 'tablets apagadas'} hace más de 2 horas`,
    hint: 'Si las apagaste a propósito, ignoralo.',
    line: (e) => `${e.name} — ${stateOf(e).label.replace('Apagada ', '')}`,
  },
};

function FleetList({ entries, search, canManage, actions, onExportCsv, onCreate }: {
  entries: TabletMonitorEntry[]; search: string; canManage: boolean; actions: TvActions;
  onExportCsv: () => void; onCreate?: () => void;
}) {
  const [tab, setTab] = useState<TabId>('all');
  const [page, setPage] = useState(1);
  // Filtros que tenía la página Tablets: por playlist y por zona.
  // Filtro avanzado ('Agregar filtro' sobre cualquier campo), persistido.
  const [advFilters, setAdvFilters] = useState<Filter[]>(() => {
    try { return JSON.parse(localStorage.getItem(LS_MONITOR_FILTERS) ?? '[]'); } catch { return []; }
  });
  const [playlistF, setPlaylistF] = useState('');
  const [zoneF, setZoneF] = useState('');
  const NONE = '__none__';
  const playlistOpts = [...new Map(entries.filter((e) => e.playlist).map((e) => [String(e.playlist!.id), e.playlist!.name])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const zoneOpts = [...new Set(entries.map((e) => e.zone).filter(Boolean) as string[])].sort();
  const byPlaylist = (e: TabletMonitorEntry) => !playlistF || (playlistF === NONE ? !e.playlist : String(e.playlist?.id) === playlistF);
  const byZone = (e: TabletMonitorEntry) => !zoneF || (zoneF === NONE ? !e.zone : e.zone === zoneF);

  const q = search.trim().toLowerCase();
  const tabDef = TABS.find((t) => t.id === tab)!;
  // eslint-disable-next-line react-hooks/purity -- filtros de "última sincronía" comparan contra la hora actual
  const nowMs = Date.now();
  const byAdv = (e: TabletMonitorEntry) => advFilters.every((f) => applyFilter(monitorFilterConfig, f, e, nowMs));
  const filtered = entries.filter((e) => tabDef.match(e) && byPlaylist(e) && byZone(e) && byAdv(e) && (!q || [e.name, e.zone, e.driverName, e.licensePlate, e.playlist?.name, e.deviceId]
    .some((v) => (v ?? '').toLowerCase().includes(q))));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const paged = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  return (
    <section className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
      {/* Pestañas */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--divider)] px-5 py-3.5">
        <h2 className="mr-2 text-xl font-bold">Flota</h2>
        {TABS.map((t) => {
          const count = entries.filter(t.match).length;
          const isActive = tab === t.id;
          const alertTab = 'alert' in t && t.alert;
          if (alertTab && count === 0 && !isActive) return null;
          const isAlert = alertTab && count > 0;
          const btn = (
            <button key={t.id} type="button" onClick={() => { setTab(t.id); setPage(1); }}
              className={`inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors ${
                isActive && !isAlert ? 'border-[var(--accent-strong)] bg-[var(--accent-strong)] text-white'
                  : isAlert ? `border-[var(--danger-border)] text-[var(--danger)] ${isActive ? 'bg-[color-mix(in_srgb,var(--danger)_14%,transparent)]' : 'hover:bg-[color-mix(in_srgb,var(--danger)_8%,transparent)]'}`
                    : 'border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-hover)]'
              }`}>
              {isAlert && <Ico d={ICONS.warn} className="h-4 w-4" />}
              {t.label}
              <span className={isActive && !isAlert ? 'text-white/80' : isAlert ? '' : 'text-[var(--muted)]'}>{count}</span>
            </button>
          );
          if (!isAlert) return btn;
          const tip = TAB_TIPS[t.id];
          const list = entries.filter(t.match);
          return (
            <div key={t.id} className="group relative">
              {btn}
              <div role="tooltip" className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-80 group-hover:block group-focus-within:block">
                <div className="rounded-xl border border-[var(--danger-border)] bg-[var(--surface-2)] p-3 text-sm shadow-2xl">
                  <p className="font-semibold text-[var(--danger)]">{tip.title(list.length)}</p>
                  <ul className="mt-1 space-y-0.5 text-[var(--text-2)]">
                    {list.slice(0, 12).map((e) => <li key={e.id}>· {tip.line(e)}</li>)}
                    {list.length > 12 && <li>… y {list.length - 12} más</li>}
                  </ul>
                  <p className="mt-1.5 text-xs text-[var(--muted)]">{tip.hint}</p>
                </div>
              </div>
            </div>
          );
        })}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select aria-label="Filtrar por playlist" value={playlistF} onChange={(ev) => { setPlaylistF(ev.target.value); setPage(1); }} className="h-9 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text-2)] outline-none focus:border-[var(--accent)]">
            <option value="">Todas las playlists</option>
            {playlistOpts.map(([id, name]) => (
              <option key={id} value={id}>{name} · {entries.filter((e) => String(e.playlist?.id) === id).length}</option>
            ))}
            <option value={NONE}>(sin playlist) · {entries.filter((e) => !e.playlist).length}</option>
          </select>
          {zoneOpts.length > 0 && (
            <select aria-label="Filtrar por zona" value={zoneF} onChange={(ev) => { setZoneF(ev.target.value); setPage(1); }} className="h-9 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text-2)] outline-none focus:border-[var(--accent)]">
              <option value="">Todas las zonas</option>
              {zoneOpts.map((z) => <option key={z} value={z}>{z}</option>)}
              <option value={NONE}>(sin zona)</option>
            </select>
          )}
          <button type="button" onClick={onExportCsv} title="Exportar todas las tablets a CSV" className={`${pill} h-9 ${V.neutral}`}>
            <Ico d={ICONS.download} />
            CSV
          </button>
          {canManage && onCreate && (
            <button type="button" onClick={onCreate} title="Dar de alta una tablet a mano (normalmente se registran solas)" className={`${pill} h-9 ${V.primary}`}>
              <Ico d={ICONS.plus} />
              Nueva tablet
            </button>
          )}
        </div>
      </div>

      {/* Filtro avanzado */}
      <div className="border-b border-[var(--divider)] px-5 py-2.5">
        <FilterBar config={monitorFilterConfig} rows={entries} filters={advFilters}
          onChange={(next) => { setAdvFilters(next); setPage(1); }} storageKey={LS_MONITOR_FILTERS}
          filteredCount={filtered.length} total={entries.length} />
      </div>

      {/* Filas compactas: una línea por tablet, columnas con un solo encabezado */}
      {filtered.length === 0 ? (
        <p className="px-6 py-8 text-sm text-[var(--muted)]">{q ? 'Ninguna tablet coincide con la búsqueda.' : 'No hay tablets en esta pestaña.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[1080px]">
            <div className={`${ROW_GRID} border-b border-[var(--divider)] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-2)]`}>
              <span />
              <span>Tablet</span>
              <span>Conexión</span>
              <span>Hoy</span>
              <span>Playlist</span>
              <span>Equipo</span>
              <span className="text-right">Acciones</span>
            </div>
            <ul>
              {paged.map((e) => {
                const st = stateOf(e);
                const isBlocked = e.health === 'blocked';
                const who = [e.zone, e.driverName, e.licensePlate].filter(Boolean).join(' · ');
                return (
                  <li key={e.id}
                    className={`${ROW_GRID} group/row border-b border-l-[3px] border-b-[var(--divider)] border-l-transparent px-5 py-2.5 text-sm transition-colors last:border-b-0 hover:border-l-[var(--accent-strong)] hover:bg-[var(--surface-2)]`}>
                    {/* Miniatura: logo de ICON + número de la tablet */}
                    <div className="relative flex h-11 w-[4.5rem] items-center gap-1 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] pl-1.5 transition-colors group-hover/row:border-[var(--accent)]">
                      <img src="/monitor/toucan.png" alt="" aria-hidden="true" className="h-5 w-auto shrink-0 opacity-90" />
                      <span className="text-base font-bold leading-none text-[var(--text-2)]">{tabletNumber(e.name)}</span>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Link href={`/tablets/${e.id}`} className="shrink-0 whitespace-nowrap font-semibold hover:text-[var(--accent)]">{e.name}</Link>
                        <span className="inline-flex min-w-0 items-center gap-1.5 truncate whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-px text-xs text-[var(--text-2)]">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: DOT[st.tone] }} />
                          {st.label}
                        </span>
                      </div>
                      <p className="truncate text-xs text-[var(--muted)]">{who || 'Sin zona asignada'}</p>
                    </div>

                    <span className="font-semibold">{relativeTime(e.lastSync)}</span>
                    <span className="font-semibold tabular-nums">{e.todayPlays.toLocaleString('es-AR')}</span>
                    <span className="truncate font-semibold" style={e.playlist ? undefined : { color: 'var(--danger)' }} title={e.playlist?.name}>
                      {e.playlist?.name ?? 'Sin asignar'}
                    </span>

                    <span className="flex items-center gap-2.5 text-xs font-semibold">
                      <span className="inline-flex items-center gap-1" style={{ color: e.batteryLevel != null ? batteryColor(e.batteryLevel) : 'var(--muted)' }}>
                        <Ico d={ICONS.battery} className="h-3.5 w-3.5" />
                        {e.batteryLevel != null ? `${e.batteryLevel}%` : '—%'}
                      </span>
                      {e.brightness != null && (
                        <span className="inline-flex items-center gap-1" style={{ color: 'var(--warn)' }}>
                          <Ico d={ICONS.sun} className="h-3.5 w-3.5" />
                          {e.brightness}%
                        </span>
                      )}
                      {e.appVersion && <span className="font-mono font-normal text-[var(--muted)]">v{e.appVersion}</span>}
                    </span>

                    {/* Acciones: "Ver pantalla" con texto; el resto, ícono con su nombre al pasar el mouse */}
                    <div className="flex items-center justify-end gap-1.5">
                      <ScreenshotViewer tabletId={e.id} tabletName={e.name} variant="tvsm" />
                      {canManage && (
                        <>
                          <IconBtn icon="power" label={actions.wakingId === e.id ? 'Enviando…' : 'Prender pantalla'}
                            onClick={() => actions.wake(e.id)} disabled={actions.wakingId === e.id} />
                          <IconBtn icon="sync" label={actions.syncingId === e.id ? 'Sincronizando…' : 'Forzar sync'}
                            onClick={() => actions.forceSync(e.id)} disabled={actions.syncingId === e.id} />
                          <IconBtn icon={isBlocked ? 'unlock' : 'lock'} v={isBlocked ? 'ok' : 'neutral'}
                            label={isBlocked ? 'Desbloquear' : 'Bloquear'}
                            onClick={() => actions.toggleBlock(e)} disabled={actions.blockingId === e.id} />
                          <Link href={`/tablets/${e.id}?editar=1`} title="Editar" aria-label="Editar" className={`${iconBtn} ${V.neutral}`}>
                            <Ico d={ICONS.edit} />
                          </Link>
                          <IconBtn icon="trash" v="danger" label="Eliminar" onClick={() => actions.remove(e)} />
                        </>
                      )}
                      <Link href={`/tablets/${e.id}`} title="Ver detalle" aria-label="Ver detalle" className={`${iconBtn} border-transparent text-[var(--accent)] hover:bg-[var(--surface-hover)]`}>
                        <Ico d={ICONS.arrow} />
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-[var(--divider)] px-6 py-3 text-sm text-[var(--muted)]">
          <span>{filtered.length} tablets · página {curPage} de {totalPages}</span>
          <div className="flex gap-2">
            <button type="button" disabled={curPage === 1} onClick={() => setPage(curPage - 1)} className={`${pill} ${V.neutral}`}>‹ Anterior</button>
            <button type="button" disabled={curPage === totalPages} onClick={() => setPage(curPage + 1)} className={`${pill} ${V.neutral}`}>Siguiente ›</button>
          </div>
        </div>
      )}
    </section>
  );
}
