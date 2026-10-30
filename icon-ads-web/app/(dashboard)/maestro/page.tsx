'use client';

import { useEffect, useMemo, useState } from 'react';
import PageShell from '@/components/ui/PageShell';
import { api, type AdDurationLimits } from '@/lib/api';
import { useToast } from '@/lib/toast-context';

// Maestro: valores que se definen acá y se aplican solos. Por ahora, cuántos
// segundos puede durar un anuncio que una empresa sube desde su portal.
export default function MaestroPage() {
  const { show } = useToast();
  const [data, setData] = useState<AdDurationLimits | null>(null);
  const [error, setError] = useState('');
  const [defaultInput, setDefaultInput] = useState('');
  // id de empresa -> texto del input ('' = usa el general)
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);

  const apply = (d: AdDurationLimits) => {
    setData(d);
    setDefaultInput(String(d.defaultSeconds));
    setOverrides(Object.fromEntries(d.clients.map((c) => [c.id, c.maxSeconds == null ? '' : String(c.maxSeconds)])));
  };

  useEffect(() => {
    api.getAdDurationLimits().then(apply).catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar'));
  }, []);

  const changedClients = useMemo(() => {
    if (!data) return [];
    return data.clients
      .filter((c) => (overrides[c.id] ?? '') !== (c.maxSeconds == null ? '' : String(c.maxSeconds)))
      .map((c) => ({ id: c.id, maxSeconds: overrides[c.id]?.trim() ? Number(overrides[c.id]) : null }));
  }, [data, overrides]);

  if (error) return <PageShell title="Maestro"><p className="text-sm text-red-600">{error}</p></PageShell>;
  if (!data) return <PageShell title="Maestro"><p style={{ color: 'var(--text-muted)' }}>Cargando...</p></PageShell>;

  const { minSeconds: min, maxSeconds: max } = data;
  const valid = (v: string) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max;
  const defaultChanged = defaultInput !== String(data.defaultSeconds);
  const invalid = (defaultChanged && !valid(defaultInput))
    || changedClients.some((c) => c.maxSeconds !== null && !valid(String(c.maxSeconds)));
  const dirty = defaultChanged || changedClients.length > 0;

  const save = async () => {
    setSaving(true);
    try {
      const d = await api.saveAdDurationLimits({
        ...(defaultChanged ? { defaultSeconds: Number(defaultInput) } : {}),
        ...(changedClients.length ? { clients: changedClients } : {}),
      });
      apply(d);
      show('Guardado. Se aplica desde la próxima subida de cada empresa.');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error al guardar', 'error');
    } finally { setSaving(false); }
  };

  const q = filter.trim().toLowerCase();
  const clients = q ? data.clients.filter((c) => c.name.toLowerCase().includes(q)) : data.clients;
  const withOwn = data.clients.filter((c) => c.maxSeconds != null).length;

  return (
    <PageShell title="Maestro" subtitle="Valores que definís acá y se aplican solos en el sistema.">
      <div className="max-w-3xl space-y-6">
        <div className="card p-6">
          <h2 className="mb-1 font-semibold">Duración máxima de los anuncios del portal</h2>
          <p className="mb-4 text-sm" style={{ color: 'var(--text-muted)' }}>
            Cuántos segundos puede durar un anuncio que una empresa sube desde su portal. Si un video dura más, no lo deja subir;
            en las imágenes sólo puede elegir hasta ese tiempo. Los anuncios que subís vos desde el panel no tienen este límite.
          </p>

          <label htmlFor="m-default" className="mb-1 block text-sm font-medium">Para todas las empresas</label>
          <div className="flex items-center gap-3">
            <input id="m-default" type="number" min={min} max={max} className="input w-28" value={defaultInput}
              onChange={(e) => setDefaultInput(e.target.value)} onWheel={(e) => e.currentTarget.blur()} />
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>segundos (de {min} a {max})</span>
          </div>
          {defaultChanged && !valid(defaultInput) && <p className="mt-1 text-xs text-red-600">Tiene que ser un número entre {min} y {max}.</p>}
        </div>

        <div className="card p-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="mb-1 font-semibold">Por empresa</h2>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Vacío = usa el general ({data.defaultSeconds} s). Si ponés un número, esa empresa usa el suyo.
                {withOwn > 0 && ` ${withOwn} con valor propio.`}
              </p>
            </div>
            {data.clients.length > 8 && (
              <input type="search" placeholder="Buscar empresa…" value={filter} onChange={(e) => setFilter(e.target.value)} className="input w-56" />
            )}
          </div>

          {data.clients.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Todavía no hay empresas.</p>
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {clients.map((c) => {
                const v = overrides[c.id] ?? '';
                const bad = v.trim() !== '' && !valid(v.trim());
                return (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5" style={{ borderTopColor: 'var(--border)' }}>
                    <span className="min-w-0 truncate text-sm">
                      {c.name}
                      {!c.active && <span className="ml-2 text-xs" style={{ color: 'var(--text-xs)' }}>(inactiva)</span>}
                    </span>
                    <div className="flex items-center gap-2">
                      <input type="number" min={min} max={max} placeholder={String(data.defaultSeconds)} aria-label={`Segundos para ${c.name}`}
                        className={`input w-24 ${bad ? 'border-red-500' : ''}`} value={v}
                        onChange={(e) => setOverrides((o) => ({ ...o, [c.id]: e.target.value }))} onWheel={(e) => e.currentTarget.blur()} />
                      <span className="w-6 text-xs" style={{ color: 'var(--text-muted)' }}>s</span>
                      <button type="button" disabled={!v} onClick={() => setOverrides((o) => ({ ...o, [c.id]: '' }))}
                        className="text-xs text-blue-600 hover:underline disabled:invisible">Usar general</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="sticky bottom-4 flex justify-end">
          <button onClick={save} disabled={!dirty || invalid || saving}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-blue-700 disabled:bg-blue-400 disabled:shadow-none">
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </PageShell>
  );
}
