'use client';

import { useCallback, useEffect, useMemo, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { portal, passwordHint, PortalAd, PortalAdStatus, PortalError, PortalMe, PortalStats, PortalUpload, PortalUploadStatus } from '@/lib/portal';
import { FormError } from '@/components/portal/AuthCard';
import UploadAdModal from '@/components/portal/UploadAdModal';

const STATUS: Record<PortalAdStatus, { label: string; color: string }> = {
  activo: { label: 'Activo', color: 'var(--ok)' },
  programado: { label: 'Programado', color: 'var(--accent)' },
  pausado: { label: 'Pausado', color: 'var(--warn)' },
  finalizado: { label: 'Finalizado', color: 'var(--muted)' },
};

const UPLOAD_STATUS: Record<PortalUploadStatus, { label: string; color: string }> = {
  revision: { label: 'En revisión', color: 'var(--warn)' },
  aprobado: { label: 'Aprobado', color: 'var(--ok)' },
  rechazado: { label: 'No aprobado', color: 'var(--muted)' },
};

const fmt = (n: number) => n.toLocaleString('es-UY');
const dayLabel = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7);

// 'YYYY-MM-DD' de hoy (o hace N días) en hora de Montevideo.
function mvdDay(daysAgo = 0) {
  return new Date(Date.now() - 3 * 3600_000 - daysAgo * 86400_000).toISOString().slice(0, 10);
}

const PRESETS = [
  { label: '7 días', days: 7 },
  { label: '30 días', days: 30 },
  { label: '90 días', days: 90 },
];

export default function PortalStatsPage() {
  const router = useRouter();
  const [me, setMe] = useState<PortalMe | null>(null);
  const [ads, setAds] = useState<PortalAd[]>([]);
  const [stats, setStats] = useState<PortalStats | null>(null);
  const [adId, setAdId] = useState('');
  const [from, setFrom] = useState(mvdDay(29));
  const [to, setTo] = useState(mvdDay());
  const [loadedKey, setLoadedKey] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploads, setUploads] = useState<PortalUpload[]>([]);
  // Botón Actualizar: cada toque vuelve a pedir anuncios, enviados y estadísticas.
  const [tick, setTick] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const onAuthError = useCallback((err: unknown) => {
    if (err instanceof PortalError && err.status === 401) { router.replace('/portal'); return true; }
    return false;
  }, [router]);

  useEffect(() => {
    Promise.all([portal.me(), portal.ads(), portal.uploads()])
      .then(([m, a, u]) => { setMe(m); setAds(a); setUploads(u); })
      .catch((err) => { if (!onAuthError(err)) setError(err.message); });
  }, [onAuthError]);

  useEffect(() => {
    if (!tick) return;
    Promise.all([portal.ads(), portal.uploads()])
      .then(([a, u]) => { setAds(a); setUploads(u); })
      .catch((err) => { if (!onAuthError(err)) setError(err.message); });
  }, [tick, onAuthError]);

  const query = useMemo(() => {
    const q = new URLSearchParams({ from, to });
    if (adId) q.set('adId', adId);
    return q;
  }, [from, to, adId]);

  const key = `${query}#${tick}`;
  const loading = loadedKey !== key;
  useEffect(() => {
    if (!me) return;
    portal.stats(query)
      .then((s) => { setStats(s); setError(''); setUpdatedAt(new Date()); })
      .catch((err) => { if (!onAuthError(err)) setError(err.message); })
      .finally(() => setLoadedKey(`${query}#${tick}`));
  }, [me, query, tick, onAuthError]);

  const logout = async () => {
    await portal.logout().catch(() => {});
    router.replace('/portal');
  };

  const preset = (days: number) => { setFrom(mvdDay(days - 1)); setTo(mvdDay()); };

  if (!me) {
    return <div className="flex min-h-screen items-center justify-center p-4 text-sm text-[var(--muted)]">{error || 'Cargando…'}</div>;
  }

  const t = stats?.totals;
  const dailyMax = Math.max(1, ...(stats?.daily.map((d) => d.count) ?? [1]));
  const change = t?.changePct == null ? undefined
    : `${t.changePct >= 0 ? '+' : ''}${t.changePct}% vs. el período anterior`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* Encabezado */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img src="/monitor/toucan.png" alt="" aria-hidden="true" className="h-10 w-auto" />
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">ICON ADS · Portal de empresas</p>
            <h1 className="text-xl font-semibold">{me.clientName}</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setShowUpload(true)} className="rounded-full bg-[var(--accent-strong)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]">Subir anuncio</button>
          <button type="button" onClick={() => setShowPassword(true)} className="rounded-full border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-2)] hover:bg-[var(--surface-hover)]">Cambiar contraseña</button>
          <button type="button" onClick={logout} className="rounded-full border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-2)] hover:bg-[var(--surface-hover)]">Salir</button>
        </div>
      </header>

      {/* Filtros */}
      <section className="card mb-6 flex flex-wrap items-end gap-3 px-5 py-4">
        <div className="min-w-[200px] flex-1">
          <label htmlFor="ad" className="mb-1 block text-xs text-[var(--muted)]">Anuncio</label>
          <select id="ad" value={adId} onChange={(e) => setAdId(e.target.value)} className="input h-10">
            <option value="">Todos mis anuncios</option>
            {ads.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="from" className="mb-1 block text-xs text-[var(--muted)]">Desde</label>
          <input id="from" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="input h-10" />
        </div>
        <div>
          <label htmlFor="to" className="mb-1 block text-xs text-[var(--muted)]">Hasta</label>
          <input id="to" type="date" value={to} min={from} max={mvdDay()} onChange={(e) => e.target.value && setTo(e.target.value)} className="input h-10" />
        </div>
        <div className="flex gap-1">
          {PRESETS.map((p) => (
            <button key={p.days} type="button" onClick={() => preset(p.days)}
              className="h-10 rounded-full border border-[var(--border)] px-3 text-sm text-[var(--text-2)] hover:bg-[var(--surface-hover)]">{p.label}</button>
          ))}
        </div>
        <button type="button" onClick={() => setTick((n) => n + 1)} disabled={loading}
          title={updatedAt ? `Actualizado a las ${updatedAt.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })}` : undefined}
          className="flex h-10 items-center gap-2 rounded-full border border-[var(--border)] px-4 text-sm text-[var(--text-2)] hover:bg-[var(--surface-hover)] disabled:opacity-60">
          <svg viewBox="0 0 24 24" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" />
          </svg>
          {loading ? 'Actualizando…' : 'Actualizar'}
        </button>
        <a href={portal.reportUrl(query)} className="flex h-10 items-center rounded-full bg-[var(--accent-strong)] px-5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]">
          Descargar PDF
        </a>
      </section>

      {error && <div className="mb-6"><FormError message={error} /></div>}

      {/* Totales */}
      <section className={`mb-6 grid grid-cols-2 gap-3 ${loading ? 'opacity-60' : ''}`}>
        <Kpi label="Reproducciones" value={t ? fmt(t.plays) : '—'} hint={change} />
        <Kpi label="Taxis asignados" value={t ? fmt(t.tabletsAssigned) : '—'} hint="taxis que tienen tu anuncio" />
      </section>

      {stats && (
        <div className={loading ? 'opacity-60' : ''}>
          {/* Por día */}
          <section className="card mb-6 px-5 py-4">
            <h2 className="mb-4 text-sm font-semibold">Reproducciones por día</h2>
            {stats.totals.plays === 0 ? <Empty /> : (
              <div className="flex h-44 items-end gap-[2px]" role="img" aria-label="Gráfico de reproducciones por día">
                {stats.daily.map((d) => (
                  <div key={d.date} className="group relative flex h-full flex-1 flex-col justify-end">
                    <div className="rounded-t-sm bg-[var(--accent-strong)] transition-colors group-hover:bg-[var(--accent)]" style={{ height: `${(d.count / dailyMax) * 100}%`, minHeight: d.count ? 2 : 0 }} />
                    <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-[var(--surface-2)] px-2 py-1 text-xs group-hover:block">
                      {dayLabel(d.date)}: {fmt(d.count)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {stats.daily.length > 0 && stats.totals.plays > 0 && (
              <div className="mt-2 flex justify-between text-xs text-[var(--muted)]">
                <span>{dayLabel(stats.daily[0].date)}</span><span>{dayLabel(stats.daily[stats.daily.length - 1].date)}</span>
              </div>
            )}
          </section>

          {/* Por anuncio */}
          <section className="card px-5 py-4">
            <h2 className="mb-3 text-sm font-semibold">Mis anuncios</h2>
            {stats.byAd.length === 0 ? <Empty text={ads.length ? undefined : 'Todavía no tenés anuncios.'} /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[var(--muted)]">
                      <th className="pb-2 font-normal">Anuncio</th>
                      <th className="pb-2 text-right font-normal">Reproducciones</th>
                      <th className="pb-2 text-right font-normal">Taxis asignados</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--divider)]">
                    {stats.byAd.map((a) => (
                      <tr key={a.id}>
                        <td className="py-3 pr-3">
                          <p className="font-medium">{a.name}</p>
                          <p className="text-xs">
                            <span className="text-[var(--muted)]">{a.type === 'video' ? 'Video' : 'Imagen'} · </span>
                            <span style={{ color: STATUS[a.status].color }}>{STATUS[a.status].label}</span>
                          </p>
                        </td>
                        <td className="py-3 text-right tabular-nums">{fmt(a.plays)}</td>
                        <td className="py-3 text-right tabular-nums">{fmt(a.tabletsAssigned)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Enviados desde el portal */}
      {uploads.length > 0 && (
        <section className="card mt-6 px-5 py-4">
          <h2 className="mb-1 text-sm font-semibold">Anuncios que enviaste</h2>
          <p className="mb-3 text-xs text-[var(--muted)]">Los revisamos antes de que salgan en los taxis.</p>
          <ul className="divide-y divide-[var(--divider)] text-sm">
            {uploads.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-medium">{u.name}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {u.type === 'video' ? 'Video' : 'Imagen'} · {u.durationS} s · enviado el {new Date(u.createdAt).toLocaleDateString('es-UY', { timeZone: 'America/Montevideo' })}
                  </p>
                </div>
                <span className="shrink-0 text-xs font-medium" style={{ color: UPLOAD_STATUS[u.status].color }}>{UPLOAD_STATUS[u.status].label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-8 text-center text-xs text-[var(--muted)]">
        Datos registrados por las tablets de la flota ICON ADS. Ingresaste como {me.email}.
      </p>

      {showPassword && <ChangePassword onClose={() => setShowPassword(false)} />}
      {showUpload && <UploadAdModal maxSeconds={me.maxAdSeconds} onClose={() => setShowUpload(false)} onUploaded={(u) => setUploads((prev) => [u, ...prev])} />}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card px-5 py-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

function Empty({ text = 'Sin reproducciones en este período.' }: { text?: string }) {
  return <p className="py-6 text-center text-sm text-[var(--muted)]">{text}</p>;
}

function ChangePassword({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const hint = passwordHint(next, confirm);
    if (hint) { setError(hint); return; }
    setError(''); setLoading(true);
    try {
      await portal.changePassword(current, next);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="pw-title" className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 id="pw-title" className="text-lg font-semibold">Cambiar contraseña</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="flex h-8 w-8 items-center justify-center rounded-full text-xl text-[var(--muted)] hover:bg-[var(--surface-hover)]">×</button>
        </div>
        {done ? (
          <>
            <p className="text-sm text-[var(--text-2)]">Listo. Tu contraseña cambió y se cerraron las sesiones en otros dispositivos.</p>
            <button type="button" onClick={onClose} className="mt-5 h-10 w-full rounded-full bg-[var(--accent-strong)] text-sm font-medium text-white">Cerrar</button>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input type="password" autoComplete="current-password" placeholder="Contraseña actual" value={current} onChange={(e) => setCurrent(e.target.value)} required className="input h-11" />
            <input type="password" autoComplete="new-password" placeholder="Contraseña nueva (mínimo 10)" value={next} onChange={(e) => setNext(e.target.value)} required className="input h-11" />
            <input type="password" autoComplete="new-password" placeholder="Repetí la nueva" value={confirm} onChange={(e) => setConfirm(e.target.value)} required className="input h-11" />
            <FormError message={error} />
            <button type="submit" disabled={loading} className="h-11 w-full rounded-full bg-[var(--accent-strong)] font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50">
              {loading ? 'Un momento…' : 'Cambiar contraseña'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
