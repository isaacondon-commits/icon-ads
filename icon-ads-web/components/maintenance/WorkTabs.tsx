'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Btn, IconBtn, TabPill } from '@/components/ui/buttons';
import type { MaintAlert, MaintAlertsResponse, MaintOrder } from '@/lib/api';
import {
  Chip, Empty, LEVEL_COLOR, PriorityChip, Progress, SOURCE_LABEL, SectionTitle, StatusChip,
  dayDiff, fmtDay, isOpen, isOverdue,
} from './shared';

// ── Alertas ────────────────────────────────────────────────────────────
export function AlertsTab({ data, canManage, onCreateOrder, onDiagnostic, onHistory }: {
  data: MaintAlertsResponse | null; canManage: boolean;
  onCreateOrder: (a: MaintAlert) => void;
  onDiagnostic: (tabletId: number, name: string) => void;
  onHistory: (tabletId: number, name: string) => void;
}) {
  if (!data) return <Empty>Cargando…</Empty>;
  const { alerts, workshop, lowStock } = data;
  // Agrupadas por tablet: una tarjeta por tablet con todas sus alertas.
  const byTablet = new Map<number, MaintAlert[]>();
  for (const a of alerts) byTablet.set(a.tabletId, [...(byTablet.get(a.tabletId) ?? []), a]);

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle right={<span className="text-xs text-[var(--muted)]">Calculadas con lo que reporta cada tablet. Las que están en taller o bloqueadas no alertan.</span>}>
          Tablets que necesitan atención ({byTablet.size})
        </SectionTitle>
        {!byTablet.size ? <Empty>Ninguna tablet necesita atención ahora.</Empty> : (
          <div className="grid gap-3 lg:grid-cols-2">
            {[...byTablet.values()].map((list) => {
              const first = list[0];
              const worst = list[0].level;
              return (
                <div key={first.tabletId} className="card p-4" style={{ borderLeft: `3px solid ${LEVEL_COLOR[worst]}` }}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Link href={`/tablets/${first.tabletId}`} className="font-semibold hover:underline">{first.tabletName}</Link>
                    <span className="text-xs text-[var(--muted)]">{[first.zone, first.driverName, first.licensePlate].filter(Boolean).join(' · ')}</span>
                    <div className="ml-auto flex gap-1.5">
                      <IconBtn icon="eye" label="Diagnóstico" onClick={() => onDiagnostic(first.tabletId, first.tabletName)} />
                      <IconBtn icon="list" label="Historial" onClick={() => onHistory(first.tabletId, first.tabletName)} />
                    </div>
                  </div>
                  <ul className="space-y-2">
                    {list.map((a) => (
                      <li key={a.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-[var(--surface-2)] px-3 py-2">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: LEVEL_COLOR[a.level] }} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{a.label}</span>
                          <span className="block text-xs text-[var(--muted)]">{a.detail}</span>
                        </span>
                        {a.orderId ? (
                          <Link href={`/maintenance/orden/${a.orderId}`} className="text-xs font-medium text-[var(--accent)] hover:underline">Orden #{a.orderId} →</Link>
                        ) : canManage ? (
                          <Btn size="sm" v="accent" icon="plus" onClick={() => onCreateOrder(a)}>Crear orden</Btn>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {list[0].openOrders > 0 && !list.some((a) => a.orderId) && (
                    <p className="mt-2 text-xs text-[var(--muted)]">Tiene {list[0].openOrders} orden(es) abierta(s) por otros motivos.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <SectionTitle>En taller ({workshop.length})</SectionTitle>
          {!workshop.length ? <Empty>No hay tablets en taller.</Empty> : (
            <div className="card divide-y divide-[var(--divider)]">
              {workshop.map((w) => (
                <div key={w.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="h-2 w-2 rounded-full bg-[var(--warn)]" />
                  <Link href={`/tablets/${w.id}`} className="text-sm font-medium hover:underline">{w.name}</Link>
                  <span className="text-xs text-[var(--muted)]">{w.zone}</span>
                  <span className="ml-auto"><IconBtn icon="list" label="Historial" onClick={() => onHistory(w.id, w.name)} /></span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section>
          <SectionTitle>Repuestos por agotarse ({lowStock.length})</SectionTitle>
          {!lowStock.length ? <Empty>El stock está bien.</Empty> : (
            <div className="card divide-y divide-[var(--divider)]">
              {lowStock.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-auto font-semibold text-[var(--danger)]">{p.stock} {p.unit}</span>
                  <span className="text-xs text-[var(--muted)]">mín. {p.minStock}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Fila de orden (lista y agenda) ─────────────────────────────────────
export function OrderRow({ o, types, compact }: { o: MaintOrder; types: Record<string, string>; compact?: boolean }) {
  const overdue = isOverdue(o);
  const done = o.checklist.filter((c) => c.done).length;
  return (
    <Link href={`/maintenance/orden/${o.id}`}
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 transition-colors hover:bg-[var(--surface-hover)]">
      <span className="w-10 text-xs text-[var(--muted)]">#{o.id}</span>
      <span className="min-w-0 flex-1 basis-56">
        <span className="block truncate text-sm font-medium">{o.title}</span>
        <span className="block text-xs text-[var(--muted)]">
          {types[o.type] ?? o.type}{o.assignee ? ` · ${o.assignee}` : ''}{o.source !== 'manual' ? ` · ${SOURCE_LABEL[o.source] ?? o.source}` : ''}
        </span>
      </span>
      {o.workshop && isOpen(o) && <Chip color="var(--warn)">En taller</Chip>}
      <PriorityChip priority={o.priority} />
      <Progress done={done} total={o.checklist.length} />
      {!compact && (
        <span className={`w-28 text-right text-xs ${overdue ? 'font-semibold text-[var(--danger)]' : 'text-[var(--text-2)]'}`}>
          {o.status === 'hecha' && o.completedAt ? `Hecha ${fmtDay(o.completedAt)}` : overdue ? `Vencida (${fmtDay(o.scheduledFor)})` : fmtDay(o.scheduledFor)}
        </span>
      )}
      <StatusChip status={o.status} />
    </Link>
  );
}

// ── Órdenes ────────────────────────────────────────────────────────────
const ORDER_FILTERS = [
  { id: 'abiertas', label: 'Abiertas', match: (o: MaintOrder) => isOpen(o) },
  { id: 'vencidas', label: 'Vencidas', match: (o: MaintOrder) => isOverdue(o), alert: true },
  { id: 'en_curso', label: 'En curso', match: (o: MaintOrder) => o.status === 'en_curso' },
  { id: 'hecha', label: 'Hechas', match: (o: MaintOrder) => o.status === 'hecha' },
  { id: 'cancelada', label: 'Canceladas', match: (o: MaintOrder) => o.status === 'cancelada' },
  { id: 'todas', label: 'Todas', match: () => true },
] as const;

export function OrdersTab({ orders, types }: { orders: MaintOrder[] | null; types: Record<string, string> }) {
  const [filter, setFilter] = useState<string>('abiertas');
  const [search, setSearch] = useState('');
  if (!orders) return <Empty>Cargando…</Empty>;
  const f = ORDER_FILTERS.find((x) => x.id === filter) ?? ORDER_FILTERS[0];
  const q = search.toLowerCase();
  const list = orders.filter(f.match).filter((o) => !q || `${o.title} ${o.tabletName ?? ''} ${o.assignee ?? ''} ${o.id}`.toLowerCase().includes(q));
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {ORDER_FILTERS.map((x) => {
          const n = orders.filter(x.match).length;
          if ('alert' in x && x.alert && !n && filter !== x.id) return null;
          return <TabPill key={x.id} active={filter === x.id} alert={'alert' in x && x.alert && n > 0} count={n} onClick={() => setFilter(x.id)}>{x.label}</TabPill>;
        })}
        <input className="input ml-auto h-9 max-w-xs" placeholder="Buscar orden, tablet o responsable…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {!list.length ? <Empty>No hay órdenes acá.</Empty> : (
        <div className="card divide-y divide-[var(--divider)] overflow-hidden">
          {list.map((o) => <OrderRow key={o.id} o={o} types={types} />)}
        </div>
      )}
    </div>
  );
}

// ── Agenda: órdenes abiertas por día ───────────────────────────────────
export function AgendaTab({ orders, types }: { orders: MaintOrder[] | null; types: Record<string, string> }) {
  const [assignee, setAssignee] = useState('');
  const groups = useMemo(() => {
    if (!orders) return [];
    const open = orders.filter(isOpen).filter((o) => !assignee || (o.assignee ?? '') === assignee);
    const out: { key: string; label: string; tone?: 'danger'; items: MaintOrder[] }[] = [];
    const overdue = open.filter(isOverdue);
    if (overdue.length) out.push({ key: 'overdue', label: 'Vencidas', tone: 'danger', items: overdue });
    const days = new Map<number, MaintOrder[]>();
    for (const o of open) {
      if (!o.scheduledFor || isOverdue(o)) continue;
      const diff = dayDiff(o.scheduledFor);
      days.set(diff, [...(days.get(diff) ?? []), o]);
    }
    for (const diff of [...days.keys()].sort((a, b) => a - b)) {
      const sample = days.get(diff)![0].scheduledFor!;
      const label = diff === 0 ? 'Hoy' : diff === 1 ? 'Mañana'
        : new Date(sample).toLocaleDateString('es-UY', { weekday: 'long', day: 'numeric', month: 'long' });
      out.push({ key: `d${diff}`, label: label.charAt(0).toUpperCase() + label.slice(1), items: days.get(diff)! });
    }
    const undated = open.filter((o) => !o.scheduledFor);
    if (undated.length) out.push({ key: 'none', label: 'Sin fecha', items: undated });
    return out;
  }, [orders, assignee]);

  if (!orders) return <Empty>Cargando…</Empty>;
  const people = [...new Set(orders.filter(isOpen).map((o) => o.assignee).filter(Boolean) as string[])].sort();
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-[var(--muted)]">Recorrido de:</span>
        <TabPill active={!assignee} onClick={() => setAssignee('')}>Todos</TabPill>
        {people.map((p) => <TabPill key={p} active={assignee === p} onClick={() => setAssignee(p)}>{p}</TabPill>)}
      </div>
      {!groups.length ? <Empty>No hay órdenes abiertas.</Empty> : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.key}>
              <h3 className={`mb-2 text-sm font-semibold ${g.tone === 'danger' ? 'text-[var(--danger)]' : 'text-[var(--text)]'}`}>
                {g.label} <span className="font-normal text-[var(--muted)]">· {g.items.length}</span>
              </h3>
              <div className="card divide-y divide-[var(--divider)] overflow-hidden">
                {g.items.map((o) => <OrderRow key={o.id} o={o} types={types} compact={g.key !== 'overdue'} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
