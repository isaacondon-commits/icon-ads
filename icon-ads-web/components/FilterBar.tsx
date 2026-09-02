'use client';

import { useState } from 'react';
import {
  type Filter, type FilterConfig, OPS_BY_TYPE, NEEDS_NO_VALUE,
  fieldDef, enumOptions, describeFilter,
} from '@/lib/filterEngine';

// Barra de filtros componibles: búsqueda rápida + "Agregar filtro" sobre
// cualquier campo, apilables (AND), con ✕ por filtro y "Limpiar todo".
export default function FilterBar<Row>({
  config, rows, filters, onChange, storageKey,
  search, onSearch, filteredCount, total, extraEnum,
}: {
  config: FilterConfig<Row>;
  rows: Row[];
  filters: Filter[];
  onChange: (next: Filter[]) => void;
  storageKey: string;
  search: string;
  onSearch: (v: string) => void;
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

  const active = filters.length > 0 || search !== '';

  return (
    <div className="flex flex-wrap gap-2 mb-4 items-center">
      <input className="input w-56" placeholder="Buscar (nombre / ID / zona)…" value={search}
        onChange={(e) => onSearch(e.target.value)} />

      {filters.map((f) => (
        <span key={f.id} className="inline-flex items-center gap-1 text-xs pl-2.5 pr-1 py-1 rounded-full bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800">
          <span className="font-medium">{describeFilter(config, f)}</span>
          <button onClick={() => save(filters.filter((x) => x.id !== f.id))}
            className="w-4 h-4 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800 leading-none" title="Quitar">×</button>
        </span>
      ))}

      {!adding ? (
        <button onClick={() => setAdding(true)}
          className="text-xs px-2.5 py-1.5 rounded-lg border font-medium border-dashed hover:bg-gray-50 dark:hover:bg-gray-800"
          style={{ borderColor: 'var(--border-md)', color: 'var(--text-muted)' }}>
          + Agregar filtro
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-lg border" style={{ borderColor: 'var(--border-md)', background: 'var(--bg)' }}>
          <select className="input !py-1 text-xs w-36" value={draft.field} onChange={(e) => setField(e.target.value)}>
            {config.fields.map((fd) => <option key={fd.key} value={fd.key}>{fd.label}</option>)}
          </select>
          <select className="input !py-1 text-xs w-auto" value={draft.op} onChange={(e) => setDraft({ ...draft, op: e.target.value })}>
            {OPS_BY_TYPE[draftType].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {needsValue && (
            draftType === 'enum' ? (
              <select className="input !py-1 text-xs w-40" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })}>
                <option value="">— elegí —</option>
                {enumOptions(config, draft.field, rows, extraEnum?.[draft.field] ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            ) : (
              <input
                className="input !py-1 text-xs w-28"
                type={draftType === 'number' || draftType === 'sync' ? 'number' : 'text'}
                placeholder={draftType === 'sync' ? 'minutos' : ''}
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
                onWheel={(e) => e.currentTarget.blur()}
                autoFocus
              />
            )
          )}
          <button onClick={commit} className="text-xs px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium">Agregar</button>
          <button onClick={() => setAdding(false)} className="text-xs px-2 py-1" style={{ color: 'var(--text-muted)' }}>Cancelar</button>
        </div>
      )}

      {active && (
        <button onClick={() => { onSearch(''); save([]); }}
          className="text-xs px-2.5 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800" style={{ color: 'var(--text-muted)' }}>
          Limpiar todo
        </button>
      )}
      <span className="text-xs ml-auto whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
        {filteredCount} de {total}
      </span>
    </div>
  );
}
