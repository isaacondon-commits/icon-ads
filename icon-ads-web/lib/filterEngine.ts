// Motor de filtros componibles reutilizable (tablets, monitor, …).

export type Filter = { id: string; field: string; op: string; value: string };

export type FieldType = 'text' | 'enum' | 'number' | 'sync';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** Valores fijos para enum; si no se pasan, se derivan de las filas. */
  fixed?: string[];
}

export const OPS_BY_TYPE: Record<FieldType, { value: string; label: string }[]> = {
  text: [
    { value: 'contains', label: 'contiene' },
    { value: 'ncontains', label: 'no contiene' },
    { value: 'eq', label: 'es exactamente' },
    { value: 'neq', label: 'no es' },
    { value: 'empty', label: 'está vacío' },
    { value: 'nempty', label: 'no está vacío' },
  ],
  enum: [
    { value: 'eq', label: 'es' },
    { value: 'neq', label: 'no es' },
  ],
  number: [
    { value: 'lte', label: '≤' },
    { value: 'gte', label: '≥' },
    { value: 'eq', label: '=' },
    { value: 'lt', label: '<' },
    { value: 'gt', label: '>' },
  ],
  sync: [
    { value: 'within', label: 'hace menos de (min)' },
    { value: 'older', label: 'hace más de (min)' },
    { value: 'never', label: 'nunca sincronizó' },
  ],
};

export const NEEDS_NO_VALUE = ['empty', 'nempty', 'never'];

export interface FilterConfig<Row> {
  fields: FieldDef[];
  /** Valor comparable de un campo. Para type 'sync' devolvé el timestamp en ms (0 = nunca). */
  getRaw: (field: string, row: Row) => string | number | null;
  /** Sólo se usa para el campo especial 'status'. */
  isOnline?: (row: Row, now: number) => boolean;
}

export function fieldDef<Row>(cfg: FilterConfig<Row>, key: string): FieldDef | undefined {
  return cfg.fields.find((f) => f.key === key);
}

export function enumOptions<Row>(cfg: FilterConfig<Row>, key: string, rows: Row[], extra: string[] = []): string[] {
  const def = fieldDef(cfg, key);
  if (def?.fixed) return def.fixed;
  const vals = new Set<string>(extra);
  for (const r of rows) {
    const v = cfg.getRaw(key, r);
    if (v != null && v !== '') vals.add(String(v));
  }
  return [...vals].sort();
}

export function applyFilter<Row>(cfg: FilterConfig<Row>, f: Filter, row: Row, now: number): boolean {
  const def = fieldDef(cfg, f.field);
  if (!def) return true;

  if (f.field === 'status' && cfg.isOnline) {
    const on = cfg.isOnline(row, now);
    const want = f.value === 'online';
    return f.op === 'neq' ? (want ? !on : on) : (want ? on : !on);
  }

  if (def.type === 'sync') {
    const ms = Number(cfg.getRaw(f.field, row)) || 0;
    if (f.op === 'never') return ms === 0;
    if (ms === 0) return f.op === 'older';
    const mins = (now - ms) / 60000;
    const n = Number(f.value);
    if (!Number.isFinite(n)) return true;
    return f.op === 'within' ? mins <= n : mins >= n;
  }

  if (def.type === 'number') {
    const raw = cfg.getRaw(f.field, row);
    if (raw == null || raw === '') return false;
    const x = Number(raw);
    const n = Number(f.value);
    if (!Number.isFinite(n)) return true;
    switch (f.op) {
      case 'lte': return x <= n;
      case 'gte': return x >= n;
      case 'lt': return x < n;
      case 'gt': return x > n;
      case 'eq': return x === n;
      default: return true;
    }
  }

  const raw = String(cfg.getRaw(f.field, row) ?? '').toLowerCase();
  const val = f.value.toLowerCase();
  switch (f.op) {
    case 'contains': return raw.includes(val);
    case 'ncontains': return !raw.includes(val);
    case 'eq': return raw === val;
    case 'neq': return raw !== val;
    case 'empty': return raw === '';
    case 'nempty': return raw !== '';
    default: return true;
  }
}

export function describeFilter<Row>(cfg: FilterConfig<Row>, f: Filter): string {
  const def = fieldDef(cfg, f.field);
  const opLabel = OPS_BY_TYPE[def?.type ?? 'text'].find((o) => o.value === f.op)?.label ?? f.op;
  const noValue = NEEDS_NO_VALUE.includes(f.op);
  return `${def?.label ?? f.field} ${opLabel}${noValue ? '' : ` ${f.value}`}`;
}
