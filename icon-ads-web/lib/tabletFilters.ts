import type { Tablet, Playlist } from './api';

export type TabletFilter = { id: string; field: string; op: string; value: string };

type FieldType = 'text' | 'enum' | 'number' | 'sync';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** Valores fijos para enum (si no, se derivan de las tablets). */
  fixed?: string[];
}

export const FILTER_FIELDS: FieldDef[] = [
  { key: 'name', label: 'Nombre', type: 'text' },
  { key: 'deviceId', label: 'Device ID', type: 'text' },
  { key: 'zone', label: 'Zona', type: 'enum' },
  { key: 'status', label: 'Estado', type: 'enum', fixed: ['online', 'offline'] },
  { key: 'manualStatus', label: 'Estado manual', type: 'enum', fixed: ['activa', 'bloqueada', 'mantenimiento'] },
  { key: 'playlist', label: 'Playlist', type: 'enum' },
  { key: 'campaign', label: 'Campaña', type: 'text' },
  { key: 'appVersion', label: 'Versión APK', type: 'enum' },
  { key: 'battery', label: 'Batería (%)', type: 'number' },
  { key: 'lastSync', label: 'Última sincronía', type: 'sync' },
  { key: 'driverName', label: 'Taxista', type: 'text' },
  { key: 'licensePlate', label: 'Matrícula', type: 'text' },
];

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

const NO_PLAYLIST = '(sin playlist)';

export function fieldDef(key: string): FieldDef | undefined {
  return FILTER_FIELDS.find((f) => f.key === key);
}

/** Opciones para un campo enum: fijas, o derivadas de las tablets / playlists. */
export function enumOptions(key: string, tablets: Tablet[], playlists: Playlist[]): string[] {
  const def = fieldDef(key);
  if (def?.fixed) return def.fixed;
  if (key === 'playlist') {
    const used = new Set<string>();
    let none = false;
    for (const t of tablets) {
      if (t.playlistId) used.add(t.playlist?.name ?? `Playlist ${t.playlistId}`);
      else none = true;
    }
    // incluir todas las playlists conocidas aunque no tengan tablets
    for (const p of playlists) used.add(p.name);
    const arr = [...used].sort();
    return none ? [NO_PLAYLIST, ...arr] : arr;
  }
  const vals = new Set<string>();
  for (const t of tablets) {
    const v = rawValue(key, t);
    if (v != null && v !== '') vals.add(String(v));
  }
  return [...vals].sort();
}

function rawValue(field: string, t: Tablet): string | number | null {
  switch (field) {
    case 'name': return t.name;
    case 'deviceId': return t.deviceId;
    case 'zone': return t.zone ?? '';
    case 'manualStatus': return t.manualStatus ?? 'activa';
    case 'appVersion': return t.appVersion ?? '';
    case 'driverName': return t.driverName ?? '';
    case 'licensePlate': return t.licensePlate ?? '';
    case 'battery': return t.batteryLevel ?? null;
    case 'campaign': return (t.campaigns ?? []).map((c) => c.name).join(' | ');
    case 'playlist': return t.playlistId ? (t.playlist?.name ?? `Playlist ${t.playlistId}`) : NO_PLAYLIST;
    default: return null;
  }
}

function isOnline(t: Tablet, now: number): boolean {
  const ms = t.lastSync ? new Date(t.lastSync).getTime() : 0;
  return !!ms && now - ms < 10 * 60000;
}

export function applyFilter(f: TabletFilter, t: Tablet, now: number): boolean {
  const def = fieldDef(f.field);
  if (!def) return true;

  if (f.field === 'status') {
    const on = isOnline(t, now);
    return f.op === 'neq' ? (f.value === 'online' ? !on : on) : (f.value === 'online' ? on : !on);
  }

  if (def.type === 'sync') {
    const ms = t.lastSync ? new Date(t.lastSync).getTime() : 0;
    if (f.op === 'never') return ms === 0;
    if (ms === 0) return f.op === 'older'; // nunca sincronizó cuenta como "hace mucho"
    const mins = (now - ms) / 60000;
    const n = Number(f.value);
    if (!Number.isFinite(n)) return true;
    return f.op === 'within' ? mins <= n : mins >= n;
  }

  if (def.type === 'number') {
    const v = rawValue(f.field, t);
    if (v == null) return false;
    const n = Number(f.value);
    const x = Number(v);
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

  // text / enum
  const raw = String(rawValue(f.field, t) ?? '').toLowerCase();
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

/** Resumen legible de un filtro para el "pill". */
export function describeFilter(f: TabletFilter): string {
  const def = fieldDef(f.field);
  const opLabel = OPS_BY_TYPE[def?.type ?? 'text'].find((o) => o.value === f.op)?.label ?? f.op;
  const noValue = f.op === 'empty' || f.op === 'nempty' || f.op === 'never';
  return `${def?.label ?? f.field} ${opLabel}${noValue ? '' : ` ${f.value}`}`;
}
