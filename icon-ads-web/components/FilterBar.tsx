'use client';

import { useState } from 'react';
import {
  type Filter, type FilterConfig, OPS_BY_TYPE, NEEDS_NO_VALUE,
  fieldDef, enumOptions, describeFilter,
} from '@/lib/filterEngine';
import { btnClass } from '@/components/ui/buttons';

// Barra de filtros componibles: "Agregar filtro" sobre cualquier campo,
// apilables (AND), con ✕ por filtro y "Limpiar todo". La búsqueda rápida es
// opcional (el Monitor ya tiene su buscador arriba).
export default function FilterBar<Row>({
  config, rows, filters, onChange, storageKey,
  search, onSearch, filteredCount, total, extraEnum,
}: {
  config: FilterConfig<Row>;
  rows: Row[];
  filters: Filter[];
  onChange: (next: Filter[]) => void;
  storageKey: string;
  search?: string;
  onSearch?: (v: string) => void;
  filteredCount: number;
  total: number;
  /** valores enum extra por campo (ej. playlists sin tablets). */
  extraEnum?: Record<string, string[]>;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ field: string; op: string; value: string }>(
    { field: config.fields[0].key, op: OPS_BY_TYPE[config.fields[0].type][0].value, value: '' },
  );

  const save = (next: Filter[]) => {
    onChange(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const draftType = fieldDef(config, draft.field)?.type ?? 'text';
  const needsValue = !NEEDS_NO_VALUE.includes(draft.op);

  const setField = (field: string) => {
    const type = fieldDef(config, field)?.type ?? 'text';
    setDraft({ field, op: OPS_BY_TYPE[type][0].value, value: '' });
  };
  const commit = () => {
    if (needsValue && draft.value.trim() === '') return;
    save([...filters, { id: crypto.randomUUID(), ...draft }]);
    setDraft({ field: config.fields[0].key, op: OPS_BY_TYPE[config.fields[0].type][0].value, value: '' });
    setAdding(false);
  };

  const active = filters.length > 0 || !!search;
  const ctl = 'h-8 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {onSearch && (
        <input className="input w-56" placeholder="Buscar (nombre / ID / zona)…" value={search ?? ''}
          onChange={(e) => onSearch(e.target.value)} />
      )}

      {filters.map((f) => (
        <span key={f.id} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] pl-3 pr-1 text-xs text-[var(--accent)]">
          <span className="font-medium">{describeFilter(config, f)}</span>
          <button type="button" onClick={() => save(filters.filter((x) => x.id !== f.id))} aria-label="Quitar filtro"
            className="flex h-6 w-6 items-center justify-center rounded-full leading-none hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)]">×</button>
        </span>
      ))}

      {!adding ? (
        <button type="button" onClick={() => setAdding(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-[var(--border)] px-3 text-xs font-medium text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]">
          + Agregar filtro
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-1">
          <select className={`${ctl} w-40`} value={draft.field} onChange={(e) => setField(e.target.value)} aria-label="Campo">
            {config.fields.map((fd) => <option key={fd.key} value={fd.key}>{fd.label}</option>)}
          </select>
          <select className={ctl} value={draft.op} onChange={(e) => setDraft({ ...draft, op: e.target.value })} aria-label="Condición">
            {OPS_BY_TYPE[draftType].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {needsValue && (
            draftType === 'enum' ? (
              <select className={`${ctl} w-44`} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} aria-label="Valor">
                <option value="">— elegí —</option>
                {enumOptions(config, draft.field, rows, extraEnum?.[draft.field] ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            ) : (
              <input
                className={`${ctl} w-28`}
                type={draftType === 'number' || draftType === 'sync' ? 'number' : 'text'}
                placeholder={draftType === 'sync' ? 'minutos' : 'valor'}
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
                onWheel={(e) => e.currentTarget.blur()}
                aria-label="Valor"
                autoFocus
              />
            )
          )}
          <button type="button" onClick={commit} className={btnClass('primary', 'sm')}>Agregar</button>
          <button type="button" onClick={() => setAdding(false)} className="px-2 text-xs text-[var(--muted)] hover:text-[var(--text)]">Cancelar</button>
        </div>
      )}

      {active && (
        <button type="button" onClick={() => { onSearch?.(''); save([]); }}
          className="px-2 text-xs text-[var(--muted)] hover:text-[var(--text)]">
          Limpiar filtros
        </button>
      )}
      <span className="ml-auto whitespace-nowrap text-xs text-[var(--muted)]">
        {filteredCount} de {total}
      </span>
    </div>
  );
}
