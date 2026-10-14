'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BandwidthStatus, TabletMonitorEntry } from '@/lib/api';
import ScreenshotViewer from '@/components/ScreenshotViewer';

// Monitor estilo Smart TV: arriba, el video de ICON de fondo con el tucán
// flotando y la tablet destacada (como el "hero" de una TV) con todas sus
// acciones; abajo, la lista de la flota de la vista clásica (pestañas con
// alertas, filas con todas las acciones), todo en la misma paleta oscura
// (azul noche + cian del logo), independiente del tema claro/oscuro del panel.

export type TvActions = {
  wake: (id: number) => void; wakingId: number | null;
  forceSync: (id: number) => void; syncingId: number | null;
  toggleBlock: (t: TabletMonitorEntry) => void; blockingId: number | null;
  remove: (t: TabletMonitorEntry) => void;
};

export type TvFleet = {
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

type Tone = 'ok' | 'bad' | 'blocked' | 'off';
function stateOf(e: TabletMonitorEntry): { label: string; tone: Tone } {
  if (e.health === 'blocked') return { label: 'Bloqueada', tone: 'blocked' };
  if (e.health === 'sin-playlist') return { label: 'Sin playlist', tone: 'bad' };
  if (e.health === 'no-reproduce') return { label: e.onFallback ? 'No cargó playlist' : 'No reproduce', tone: 'bad' };
  if (e.status === 'online') return { label: 'En línea', tone: 'ok' };
  if (e.offlineMinutes > 48 * 60) return { label: `Apagada hace ${Math.floor(e.offlineMinutes / 1440)} d`, tone: 'off' };
  if (e.offlineMinutes > 60) return { label: `Apagada hace ${Math.floor(e.offlineMinutes / 60)} h`, tone: 'off' };
  return { label: 'Fuera de línea', tone: 'off' };
}

const TONE = {
  ok: { dot: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]', pill: 'bg-emerald-400/15 text-emerald-200 ring-emerald-300/30', card: 'from-sky-500/35 via-blue-700/25 to-[#06101f]' },
  bad: { dot: 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.9)] animate-pulse', pill: 'bg-rose-400/15 text-rose-200 ring-rose-300/30', card: 'from-rose-500/35 via-fuchsia-900/25 to-[#06101f]' },
  blocked: { dot: 'bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.8)]', pill: 'bg-amber-300/15 text-amber-100 ring-amber-200/30', card: 'from-amber-400/30 via-orange-900/20 to-[#06101f]' },
  off: { dot: 'bg-slate-400', pill: 'bg-white/10 text-slate-300 ring-white/15', card: 'from-slate-500/25 via-slate-800/30 to-[#06101f]' },
} as const;

const ICONS = {
  screen: 'M3 5h18v12H3zM8 21h8M12 17v4',
  power: 'M12 3v8M6.3 7.3a8 8 0 1 0 11.4 0',
  sync: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  unlock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
} as const;

function Ico({ d, className = 'h-4 w-4' }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const glassBtn = 'inline-flex items-center gap-2 h-10 px-4 rounded-full text-sm font-medium text-white/90 bg-white/[0.08] ring-1 ring-white/15 backdrop-blur-md transition hover:bg-white/[0.16] hover:text-white disabled:opacity-40';

function TvButton({ icon, children, onClick, disabled, tone = 'glass', title }: {
  icon: keyof typeof ICONS; children: React.ReactNode; onClick: () => void; disabled?: boolean;
  tone?: 'glass' | 'danger' | 'success'; title?: string;
}) {
  const cls = tone === 'danger'
    ? 'inline-flex items-center gap-2 h-10 px-4 rounded-full text-sm font-medium text-rose-200 bg-rose-500/10 ring-1 ring-rose-300/25 backdrop-blur-md transition hover:bg-rose-500/25 disabled:opacity-40'
    : tone === 'success'
      ? 'inline-flex items-center gap-2 h-10 px-4 rounded-full text-sm font-medium text-emerald-100 bg-emerald-500/15 ring-1 ring-emerald-300/30 backdrop-blur-md transition hover:bg-emerald-500/25 disabled:opacity-40'
      : glassBtn;
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className={cls}>
      <Ico d={ICONS[icon]} />
      {children}
    </button>
  );
}

function tabletNumber(name: string) {
  const m = name.match(/(\d+)\s*$/);
  return m ? m[1].padStart(2, '0') : name.slice(0, 2).toUpperCase();
}

export default function TvMonitor({ entries, loading, error, countdown, onRefresh, canManage, actions, fleet }: Props) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // null en el primer render: el reloj sólo existe en el navegador (evita
  // diferencias de hidratación entre servidor y cliente).
  const [clock, setClock] = useState<Date | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tick = () => setClock(new Date());
    tick();
    const t = setInterval(tick, 15_000);
    return () => clearInterval(t);
  }, []);

  // Destacada por defecto: la primera que requiere atención; si no, la primera.
  const fallback = entries.find((e) => ['bad', 'blocked'].includes(stateOf(e).tone)) ?? entries[0] ?? null;
  const selected = entries.find((e) => e.id === selectedId) ?? fallback;
  const select = (e: TabletMonitorEntry) => {
    setSelectedId(e.id);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const online = entries.filter((e) => e.status === 'online').length;
  const totalPlays = entries.reduce((n, e) => n + e.todayPlays, 0);
  const bw = fleet.bw;

  return (
    <div ref={topRef} className="tv-root relative isolate -m-4 sm:-m-6 lg:-m-8 min-h-screen overflow-hidden bg-[#030812] text-white">
      <style>{`
        @keyframes tv-float { 0%,100% { transform: translateY(0) rotate(-2deg) } 50% { transform: translateY(-16px) rotate(1.5deg) } }
        @keyframes tv-glow { 0%,100% { opacity: .55 } 50% { opacity: .95 } }
        @keyframes tv-drift { 0% { transform: scale(1.08) translateX(0) } 100% { transform: scale(1.08) translateX(-2%) } }
        @media (prefers-reduced-motion: reduce) { .tv-anim { animation: none !important } }
      `}</style>

      {/* Fondo: el video de ICON sólo detrás de la parte de arriba (tipo TV);
          más abajo, azul noche liso para que la lista se lea bien. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-20 h-[100vh] overflow-hidden">
        <video className="tv-anim h-full w-full object-cover opacity-45"
          style={{ animation: 'tv-drift 30s ease-in-out infinite alternate' }}
          src="/monitor/bg.mp4" poster="/monitor/bg-poster.jpg" autoPlay muted loop playsInline aria-hidden="true" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#030812] via-[#030812]/85 to-[#030812]/30" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#030812] via-[#030812]/30 to-transparent" />
      </div>
      <div className="pointer-events-none absolute -right-40 -top-40 -z-10 h-[520px] w-[520px] rounded-full bg-sky-500/20 blur-3xl tv-anim"
        style={{ animation: 'tv-glow 7s ease-in-out infinite' }} />

      {/* Tucán flotando */}
      <img src="/monitor/toucan.png" alt="" aria-hidden="true"
        className="tv-anim pointer-events-none absolute right-[4%] top-24 -z-10 hidden w-[min(34vw,440px)] opacity-90 drop-shadow-[0_0_40px_rgba(56,189,248,0.45)] md:block"
        style={{ animation: 'tv-float 7s ease-in-out infinite' }} />

      <div className="relative px-6 pb-10 pt-5 sm:px-10">
        {/* Barra superior */}
        <header className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2.5">
            <img src="/monitor/toucan.png" alt="" className="h-8 w-auto" />
            <div className="leading-tight">
              <p className="text-sm font-bold tracking-wide"><span className="text-sky-300">ICON</span><span className="text-sky-100">ADS</span></p>
              <p className="text-[11px] uppercase tracking-[0.2em] text-sky-200/60">Monitor en vivo</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-white/[0.07] px-3 py-1.5 ring-1 ring-white/10">
              <b className="text-emerald-300">{online}</b><span className="text-white/60"> de {entries.length} en línea</span>
            </span>
            <span className="rounded-full bg-white/[0.07] px-3 py-1.5 ring-1 ring-white/10">
              <b className="text-sky-300">{totalPlays.toLocaleString('es-AR')}</b><span className="text-white/60"> reproducciones hoy</span>
            </span>
            {bw && (
              <span className={`rounded-full px-3 py-1.5 ring-1 ${bw.frozen ? 'bg-sky-400/15 text-sky-100 ring-sky-300/30' : 'bg-emerald-400/10 text-emerald-200 ring-emerald-300/25'}`}>
                {bw.frozen ? '🧊 Producción congelada' : '● Producción activa'}
              </span>
            )}
            {bw?.circuitOpen && (
              <span className="rounded-full bg-rose-500/20 px-3 py-1.5 font-semibold text-rose-100 ring-1 ring-rose-300/40">Disyuntor abierto</span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar tablet, zona, taxista…"
              className="h-10 w-56 rounded-full bg-white/[0.08] px-4 text-sm text-white placeholder:text-white/40 ring-1 ring-white/15 backdrop-blur-md outline-none focus:ring-sky-300/60" />
            <button type="button" onClick={onRefresh} title="Actualizar ahora" className={`${glassBtn} px-3`}>
              <Ico d={ICONS.refresh} />
              <span className="tabular-nums text-xs text-white/60">{countdown}s</span>
            </button>
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-2xl font-light tabular-nums">{clock?.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: false }) ?? '--:--'}</p>
              <p className="text-[11px] capitalize text-white/50">{clock?.toLocaleDateString('es-UY', { weekday: 'long', day: 'numeric', month: 'short' }) ?? ''}</p>
            </div>
          </div>
        </header>

        {/* Tablet destacada */}
        <section className="mt-10 min-h-[300px] max-w-4xl">
          {loading ? (
            <p className="text-white/60">Cargando flota…</p>
          ) : error ? (
            <p className="text-rose-300">{error}</p>
          ) : !selected ? (
            <p className="text-white/60">No hay tablets registradas.</p>
          ) : (
            <Hero e={selected} canManage={canManage} actions={actions} />
          )}
        </section>

        {!loading && !error && entries.length > 0 && (
          <FleetList entries={entries} search={search} selectedId={selected?.id ?? null} onSelect={select}
            canManage={canManage} actions={actions} />
        )}

        {/* Controles de flota */}
        {canManage && (
          <footer className="mt-8 flex flex-wrap items-center gap-3 rounded-3xl bg-white/[0.05] p-4 ring-1 ring-white/10 backdrop-blur-xl">
            <span className="mr-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-200/70">Flota</span>
            <div className="flex min-w-[260px] flex-1 items-center gap-3">
              <Ico d={ICONS.sun} className="h-4 w-4 text-amber-200" />
              <button type="button" onClick={() => fleet.commitBrightness('auto')} disabled={fleet.savingBright}
                className={`h-8 rounded-full px-3 text-xs font-medium ring-1 transition disabled:opacity-40 ${fleet.brightAuto ? 'bg-sky-400 text-[#031022] ring-sky-300' : 'bg-white/[0.08] text-white/80 ring-white/15 hover:bg-white/15'}`}>
                Auto (solar)
              </button>
              <input type="range" min={5} max={100} step={5} value={fleet.brightPct} disabled={fleet.savingBright}
                onChange={(ev) => fleet.setBrightPct(Number(ev.target.value))}
                onPointerUp={() => fleet.commitBrightness(fleet.brightPct)}
                onKeyUp={(ev) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) fleet.commitBrightness(fleet.brightPct); }}
                className="flex-1 accent-sky-400" aria-label="Brillo de la flota" />
              <span className="w-12 text-right text-sm tabular-nums">{fleet.brightAuto ? 'auto' : `${fleet.brightPct}%`}</span>
            </div>
            <TvButton icon="power" onClick={fleet.onWakeAll} disabled={fleet.wakingAll}>
              {fleet.wakingAll ? 'Enviando…' : 'Prender todas'}
            </TvButton>
            <TvButton icon={fleet.allBlocked ? 'unlock' : 'lock'} tone={fleet.allBlocked ? 'success' : 'glass'} onClick={fleet.onBlockAll} disabled={fleet.blockingAll}>
              {fleet.blockingAll ? 'Aplicando…' : fleet.allBlocked ? 'Desbloquear todas' : 'Bloquear todas'}
            </TvButton>
            {bw && (
              <TvButton icon="lock" onClick={fleet.onFreezeToggle} disabled={fleet.togglingFreeze}
                title={bw.frozen ? 'Las tablets vuelven a poder descargar playlists' : 'Ninguna tablet descarga; siguen reproduciendo lo que tienen'}>
                {fleet.togglingFreeze ? '…' : bw.frozen ? 'Descongelar producción' : 'Congelar producción'}
              </TvButton>
            )}
            {bw?.circuitOpen && (
              <TvButton icon="refresh" tone="danger" onClick={fleet.onResetCircuit} disabled={fleet.resettingCircuit}>
                {fleet.resettingCircuit ? 'Reseteando…' : 'Resetear disyuntor'}
              </TvButton>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}


function Hero({ e, canManage, actions }: { e: TabletMonitorEntry; canManage: boolean; actions: TvActions }) {
  const st = stateOf(e);
  const isBlocked = e.health === 'blocked';
  const who = [e.zone, e.driverName, e.licensePlate].filter(Boolean).join(' · ');
  const stats = [
    { k: 'Última conexión', v: relativeTime(e.lastSync) },
    { k: 'Reproducciones hoy', v: e.todayPlays.toLocaleString('es-AR') },
    { k: 'Playlist', v: e.playlist?.name ?? 'Sin asignar', bad: !e.playlist },
    { k: 'Batería', v: e.batteryLevel != null ? `${e.batteryLevel}%` : '—', bad: e.batteryLevel != null && e.batteryLevel <= 20 },
    { k: 'Brillo', v: e.brightness != null ? `${e.brightness}%${e.brightnessAuto ? ' auto' : ''}` : '—' },
    { k: 'App', v: e.appVersion ? `v${e.appVersion}` : '—' },
  ];
  return (
    <div key={e.id} className="animate-[fadeIn_.35s_ease-out]">
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }`}</style>
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-sky-300/80">Tablet seleccionada</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">{e.name}</h1>
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ring-1 ${TONE[st.tone].pill}`}>
          <span className={`h-2 w-2 rounded-full ${TONE[st.tone].dot}`} />
          {st.label}
        </span>
      </div>
      <p className="mt-2 text-sm text-white/55">{who || 'Sin zona asignada'}{e.serial ? ` · SN ${e.serial}` : ''}</p>

      <dl className="mt-6 grid max-w-2xl grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.k}>
            <dt className="text-[11px] uppercase tracking-wider text-white/45">{s.k}</dt>
            <dd className={`truncate text-base font-semibold ${s.bad ? 'text-rose-300' : 'text-white/95'}`}>{s.v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-7 flex flex-wrap items-center gap-2.5">
        <ScreenshotViewer tabletId={e.id} tabletName={e.name} variant="tv" />
        {canManage && (
          <>
            <TvButton icon="power" onClick={() => actions.wake(e.id)} disabled={actions.wakingId === e.id}
              title="Enciende la pantalla aunque el auto esté sin contacto (necesita señal)">
              {actions.wakingId === e.id ? 'Enviando…' : 'Prender pantalla'}
            </TvButton>
            <TvButton icon="sync" onClick={() => actions.forceSync(e.id)} disabled={actions.syncingId === e.id}
              title="Fuerza a la tablet a sincronizar ahora">
              {actions.syncingId === e.id ? 'Sincronizando…' : 'Forzar sync'}
            </TvButton>
            <TvButton icon={isBlocked ? 'unlock' : 'lock'} tone={isBlocked ? 'success' : 'glass'}
              onClick={() => actions.toggleBlock(e)} disabled={actions.blockingId === e.id}
              title={isBlocked ? 'Vuelve a mostrar publicidad' : 'Frena la publicidad sin desarmar el kiosco'}>
              {actions.blockingId === e.id ? 'Aplicando…' : isBlocked ? 'Desbloquear' : 'Bloquear'}
            </TvButton>
            <Link href={`/tablets/${e.id}?editar=1`} className={glassBtn}>
              <Ico d={ICONS.edit} />
              Editar
            </Link>
            <TvButton icon="trash" tone="danger" onClick={() => actions.remove(e)} title="Elimina la tablet del sistema">
              Eliminar
            </TvButton>
          </>
        )}
      </div>
    </div>
  );
}

// ── Lista de la flota (la idea de la vista clásica, en estilo TV) ───────────

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

const smBtn = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium whitespace-nowrap ring-1 backdrop-blur-md transition disabled:opacity-40';
const SM_TONE = {
  glass: 'text-white/85 bg-white/[0.07] ring-white/15 hover:bg-white/[0.15] hover:text-white',
  success: 'text-emerald-100 bg-emerald-500/15 ring-emerald-300/30 hover:bg-emerald-500/25',
  danger: 'text-rose-200 bg-rose-500/10 ring-rose-300/25 hover:bg-rose-500/25',
} as const;

function SmButton({ icon, tone = 'glass', onClick, disabled, title, children }: {
  icon: keyof typeof ICONS; tone?: keyof typeof SM_TONE; onClick: () => void; disabled?: boolean; title?: string; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={(ev) => { ev.stopPropagation(); onClick(); }} disabled={disabled} title={title}
      className={`${smBtn} ${SM_TONE[tone]}`}>
      <Ico d={ICONS[icon]} className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

function FleetList({ entries, search, selectedId, onSelect, canManage, actions }: {
  entries: TabletMonitorEntry[]; search: string; selectedId: number | null;
  onSelect: (e: TabletMonitorEntry) => void; canManage: boolean; actions: TvActions;
}) {
  const [tab, setTab] = useState<TabId>('all');
  const [page, setPage] = useState(1);

  const q = search.trim().toLowerCase();
  const tabDef = TABS.find((t) => t.id === tab)!;
  const filtered = entries.filter((e) => tabDef.match(e) && (!q || [e.name, e.zone, e.driverName, e.licensePlate, e.playlist?.name, e.deviceId]
    .some((v) => (v ?? '').toLowerCase().includes(q))));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const paged = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  return (
    <section className="mt-10 rounded-3xl bg-[#071225]/70 ring-1 ring-white/10 backdrop-blur-xl">
      {/* Pestañas */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-5 py-4">
        <h2 className="mr-2 text-lg font-semibold">Flota</h2>
        {TABS.map((t) => {
          const count = entries.filter(t.match).length;
          const isActive = tab === t.id;
          const alertTab = 'alert' in t && t.alert;
          if (alertTab && count === 0 && !isActive) return null;
          const isAlert = alertTab && count > 0;
          const btn = (
            <button key={t.id} type="button" onClick={() => { setTab(t.id); setPage(1); }}
              className={`h-8 rounded-full px-3.5 text-sm font-medium ring-1 transition ${
                isActive
                  ? (isAlert ? 'bg-rose-500 text-white ring-rose-400' : 'bg-sky-400 text-[#031022] ring-sky-300')
                  : isAlert ? 'bg-rose-500/10 text-rose-200 ring-rose-400/40 hover:bg-rose-500/20'
                    : 'bg-white/[0.05] text-white/70 ring-white/10 hover:bg-white/[0.12] hover:text-white'
              }`}>
              {isAlert && '⚠ '}{t.label} <span className={isActive ? 'opacity-70' : isAlert ? 'text-rose-300' : 'text-white/40'}>{count}</span>
            </button>
          );
          if (!isAlert) return btn;
          const tip = TAB_TIPS[t.id];
          const list = entries.filter(t.match);
          return (
            <div key={t.id} className="group relative">
              {btn}
              <div role="tooltip" className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-80 group-hover:block group-focus-within:block">
                <div className="rounded-2xl bg-[#0b1830]/95 p-3 text-sm shadow-2xl ring-1 ring-rose-300/30 backdrop-blur-xl">
                  <p className="font-semibold text-rose-200">{tip.title(list.length)}</p>
                  <ul className="mt-1 space-y-0.5 text-white/75">
                    {list.slice(0, 12).map((e) => <li key={e.id}>· {tip.line(e)}</li>)}
                    {list.length > 12 && <li>… y {list.length - 12} más</li>}
                  </ul>
                  <p className="mt-1.5 text-xs text-white/50">{tip.hint}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filas */}
      {filtered.length === 0 ? (
        <p className="px-5 py-8 text-sm text-white/50">{q ? 'Ninguna tablet coincide con la búsqueda.' : 'No hay tablets en esta pestaña.'}</p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {paged.map((e) => {
            const st = stateOf(e);
            const isSel = e.id === selectedId;
            const isBlocked = e.health === 'blocked';
            const who = [e.zone, e.driverName, e.licensePlate].filter(Boolean).join(' · ');
            return (
              <li key={e.id} onClick={() => onSelect(e)}
                className={`cursor-pointer px-5 py-4 transition ${isSel ? 'bg-sky-400/[0.08] shadow-[inset_3px_0_0_rgba(125,211,252,0.9)]' : 'hover:bg-white/[0.03]'}`}>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  {/* Miniatura tipo TV */}
                  <div className={`relative aspect-video w-28 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br ring-1 ${TONE[st.tone].card} ${isSel ? 'ring-sky-300/70' : 'ring-white/10'}`}>
                    <span className="absolute -bottom-2 right-1 text-5xl font-black leading-none text-white/[0.12]">{tabletNumber(e.name)}</span>
                    <span className={`absolute left-2 top-2 h-2 w-2 rounded-full ${TONE[st.tone].dot}`} />
                  </div>

                  <div className="min-w-0 flex-1 basis-52">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-base font-semibold">{e.name}</span>
                      <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${TONE[st.tone].pill}`}>{st.label}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-white/45">{who || 'Sin zona asignada'}</p>
                  </div>

                  <dl className="grid shrink-0 grid-cols-2 gap-x-8 gap-y-1 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-white/40">Última conexión</dt>
                      <dd className={`font-semibold ${e.status === 'online' ? 'text-white/90' : 'text-white/55'}`}>{relativeTime(e.lastSync)}</dd>
                    </div>
                    <div>
                      <dt className="text-white/40">Reproducciones hoy</dt>
                      <dd className={`font-semibold tabular-nums ${e.todayPlays > 0 ? 'text-sky-300' : 'text-white/55'}`}>{e.todayPlays.toLocaleString('es-AR')}</dd>
                    </div>
                    <div className="max-w-[10rem]">
                      <dt className="text-white/40">Playlist</dt>
                      <dd className={`truncate font-semibold ${e.playlist ? 'text-white/90' : 'text-rose-300'}`}>{e.playlist?.name ?? 'Sin asignar'}</dd>
                    </div>
                    <div>
                      <dt className="text-white/40">Equipo</dt>
                      <dd className="flex gap-2 text-white/70">
                        {e.batteryLevel != null && <span className={e.batteryLevel <= 20 ? 'font-semibold text-rose-300' : ''}>🔋 {e.batteryLevel}%</span>}
                        {e.brightness != null && <span>☀ {e.brightness}%</span>}
                        {e.appVersion && <span className="font-mono">v{e.appVersion}</span>}
                        {e.batteryLevel == null && e.brightness == null && !e.appVersion && <span>—</span>}
                      </dd>
                    </div>
                  </dl>
                </div>

                {/* Acciones de la fila, todas juntas */}
                <div className="mt-3 flex flex-wrap items-center gap-2 sm:pl-[8.5rem]" onClick={(ev) => ev.stopPropagation()}>
                  <ScreenshotViewer tabletId={e.id} tabletName={e.name} variant="tvsm" />
                  {canManage && (
                    <>
                      <SmButton icon="power" onClick={() => actions.wake(e.id)} disabled={actions.wakingId === e.id}
                        title="Enciende la pantalla aunque el auto esté sin contacto (necesita señal)">
                        {actions.wakingId === e.id ? 'Enviando…' : 'Prender pantalla'}
                      </SmButton>
                      <SmButton icon="sync" onClick={() => actions.forceSync(e.id)} disabled={actions.syncingId === e.id}
                        title="Fuerza a la tablet a sincronizar ahora">
                        {actions.syncingId === e.id ? 'Sincronizando…' : 'Forzar sync'}
                      </SmButton>
                      <SmButton icon={isBlocked ? 'unlock' : 'lock'} tone={isBlocked ? 'success' : 'glass'}
                        onClick={() => actions.toggleBlock(e)} disabled={actions.blockingId === e.id}
                        title={isBlocked ? 'Vuelve a mostrar publicidad' : 'Frena la publicidad sin desarmar el kiosco'}>
                        {actions.blockingId === e.id ? 'Aplicando…' : isBlocked ? 'Desbloquear' : 'Bloquear'}
                      </SmButton>
                      <Link href={`/tablets/${e.id}?editar=1`} className={`${smBtn} ${SM_TONE.glass}`}>
                        <Ico d={ICONS.edit} className="h-3.5 w-3.5" />
                        Editar
                      </Link>
                      <SmButton icon="trash" tone="danger" onClick={() => actions.remove(e)} title="Elimina la tablet del sistema">
                        Eliminar
                      </SmButton>
                    </>
                  )}
                  <Link href={`/tablets/${e.id}`} className="ml-auto text-xs text-sky-300/80 hover:text-sky-200 hover:underline">
                    Ver detalle →
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-white/10 px-5 py-3 text-sm text-white/60">
          <span>{filtered.length} tablets · página {curPage} de {totalPages}</span>
          <div className="flex gap-2">
            <button type="button" disabled={curPage === 1} onClick={() => setPage(curPage - 1)} className={`${smBtn} ${SM_TONE.glass}`}>‹ Anterior</button>
            <button type="button" disabled={curPage === totalPages} onClick={() => setPage(curPage + 1)} className={`${smBtn} ${SM_TONE.glass}`}>Siguiente ›</button>
          </div>
        </div>
      )}
    </section>
  );
}
