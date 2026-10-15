'use client';

import type { MaintOrder, MaintPriority, MaintStatus } from '@/lib/api';

// Piezas compartidas de Mantenimiento: etiquetas, colores y fechas.

export const STATUS_LABEL: Record<MaintStatus, string> = {
  pendiente: 'Pendiente', en_curso: 'En curso', hecha: 'Hecha', cancelada: 'Cancelada',
};
const STATUS_COLOR: Record<MaintStatus, string> = {
  pendiente: 'var(--warn)', en_curso: 'var(--accent)', hecha: 'var(--ok)', cancelada: 'var(--muted-2)',
};
export const PRIORITY_LABEL: Record<MaintPriority, string> = {
  baja: 'Baja', normal: 'Normal', alta: 'Alta', urgente: 'Urgente',
};
const PRIORITY_COLOR: Record<MaintPriority, string> = {
  baja: 'var(--muted)', normal: 'var(--text-2)', alta: 'var(--warn)', urgente: 'var(--danger)',
};
export const LEVEL_COLOR = { danger: 'var(--danger)', warn: 'var(--warn)', info: 'var(--accent)' } as const;

export const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual', alerta: 'Desde alerta', recurrente: 'Recurrente',
};

export function Chip({ color, children, title }: { color: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{ color, borderColor: `color-mix(in srgb, ${color} 40%, transparent)`, background: `color-mix(in srgb, ${color} 10%, transparent)` }}>
      {children}
    </span>
  );
}

export function StatusChip({ status }: { status: MaintStatus }) {
  return <Chip color={STATUS_COLOR[status]}><span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[status] }} />{STATUS_LABEL[status]}</Chip>;
}

export function PriorityChip({ priority }: { priority: MaintPriority }) {
  if (priority === 'normal') return null;
  return <Chip color={PRIORITY_COLOR[priority]}>{PRIORITY_LABEL[priority]}</Chip>;
}

export const isOpen = (o: Pick<MaintOrder, 'status'>) => o.status === 'pendiente' || o.status === 'en_curso';

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

export function isOverdue(o: Pick<MaintOrder, 'status' | 'scheduledFor'>) {
  return isOpen(o) && !!o.scheduledFor && new Date(o.scheduledFor) < startOfDay(new Date());
}

export function dayDiff(iso: string) {
  return Math.round((startOfDay(new Date(iso)).getTime() - startOfDay(new Date()).getTime()) / 86400000);
}

export function fmtDay(iso: string | null, withTime = false) {
  if (!iso) return 'Sin fecha';
  const d = new Date(iso);
  const diff = dayDiff(iso);
  const base = diff === 0 ? 'Hoy' : diff === 1 ? 'Mañana' : diff === -1 ? 'Ayer'
    : d.toLocaleDateString('es-UY', { weekday: 'short', day: 'numeric', month: 'short' });
  return withTime ? `${base} ${d.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })}` : base;
}

export function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('es-UY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}

export function timeAgo(iso: string | null) {
  if (!iso) return 'nunca';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  if (min < 1440) return `hace ${Math.floor(min / 60)} h`;
  return `hace ${Math.floor(min / 1440)} d`;
}

// Valor para <input type="datetime-local"> en hora local.
export function toLocalInput(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

export function Progress({ done, total }: { done: number; total: number }) {
  if (!total) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <span className="inline-flex items-center gap-2 text-xs text-[var(--muted)]" title={`${done} de ${total} tareas`}>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-[var(--border)]">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: pct === 100 ? 'var(--ok)' : 'var(--accent)' }} />
      </span>
      {done}/{total}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card p-8 text-center text-sm text-[var(--muted)]">{children}</div>;
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold text-[var(--text)]">{children}</h2>
      {right}
    </div>
  );
}
