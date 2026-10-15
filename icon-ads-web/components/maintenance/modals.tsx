'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Modal, { Field } from '@/components/ui/Modal';
import { Btn } from '@/components/ui/buttons';
import { api, MaintDiagnostic, MaintMeta, MaintOrder, MaintPriority, TabletMonitorEntry } from '@/lib/api';
import { useToast } from '@/lib/toast-context';
import { Chip, PRIORITY_LABEL, Progress, StatusChip, fmtDate, fmtDay, fromLocalInput, timeAgo, toLocalInput } from './shared';

// ── Nueva orden (una por tablet elegida) ───────────────────────────────
export interface NewOrderPreset {
  tabletIds?: number[]; type?: string; title?: string; alertCode?: string; source?: string; notes?: string; workshop?: boolean;
}

export function NewOrderModal({ tablets, meta, preset, assignees, onClose, onCreated }: {
  tablets: TabletMonitorEntry[]; meta: MaintMeta; preset?: NewOrderPreset; assignees: string[];
  onClose: () => void; onCreated: (orders: MaintOrder[]) => void;
}) {
  const { show } = useToast();
  const [selected, setSelected] = useState<number[]>(preset?.tabletIds ?? []);
  const [search, setSearch] = useState('');
  const [type, setType] = useState(preset?.type ?? 'revision');
  const [title, setTitle] = useState(preset?.title ?? '');
  const [priority, setPriority] = useState<MaintPriority>('normal');
  const [date, setDate] = useState(() => toLocalInput(new Date(Date.now() + 86400000).toISOString()).slice(0, 11) + '09:00');
  const [assignee, setAssignee] = useState('');
  const [notes, setNotes] = useState(preset?.notes ?? '');
  const [workshop, setWorkshop] = useState(preset?.workshop ?? false);
  const [saving, setSaving] = useState(false);

  const filtered = tablets.filter((t) => `${t.name} ${t.zone ?? ''} ${t.licensePlate ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const checklist = meta.checklists[type] ?? [];

  const submit = async () => {
    if (!selected.length) { show('Elegí al menos una tablet', 'error'); return; }
    setSaving(true);
    try {
      const orders = await api.createMaintOrders({
        tabletIds: selected, type, title: selected.length === 1 ? title : undefined, priority,
        scheduledFor: fromLocalInput(date), assignee: assignee || null, notes: notes || null, workshop,
        source: preset?.source ?? 'manual', alertCode: preset?.alertCode ?? null,
      });
      show(orders.length === 1 ? `Orden #${orders[0].id} creada` : `${orders.length} órdenes creadas`);
      onCreated(orders);
    } catch (e) {
      show(e instanceof Error ? e.message : 'No se pudo crear', 'error');
    } finally { setSaving(false); }
  };

  return (
    <Modal title="Nueva orden de mantenimiento" onClose={onClose} wide>
      <div className="space-y-4">
        <Field label={`Tablets (${selected.length} elegida${selected.length === 1 ? '' : 's'})`}>
          <div className="rounded-xl border border-[var(--border)]">
            <div className="flex gap-2 border-b border-[var(--divider)] p-2">
              <input className="input h-9" placeholder="Buscar por nombre, zona o matrícula…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Btn size="sm" onClick={() => setSelected(filtered.map((t) => t.id))}>Todas</Btn>
              <Btn size="sm" v="ghost" onClick={() => setSelected([])}>Ninguna</Btn>
            </div>
            <div className="max-h-48 overflow-y-auto p-1">
              {filtered.map((t) => (
                <label key={t.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--surface-hover)]">
                  <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} className="h-4 w-4 accent-[var(--accent-strong)]" />
                  <span className="font-medium">{t.name}</span>
                  <span className="text-xs text-[var(--muted)]">{[t.zone, t.licensePlate].filter(Boolean).join(' · ')}</span>
                  {t.health === 'taller' && <span className="ml-auto"><Chip color="var(--warn)">En taller</Chip></span>}
                </label>
              ))}
              {!filtered.length && <p className="p-3 text-sm text-[var(--muted)]">Sin resultados.</p>}
            </div>
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo">
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(meta.types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Prioridad">
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as MaintPriority)}>
              {meta.priorities.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          </Field>
          <Field label="Fecha">
            <input type="datetime-local" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Responsable">
            <input className="input" list="maint-assignees" placeholder="Quién la hace" value={assignee} onChange={(e) => setAssignee(e.target.value)} />
            <datalist id="maint-assignees">{assignees.map((a) => <option key={a} value={a} />)}</datalist>
          </Field>
        </div>
        {selected.length <= 1 && (
          <Field label="Título (opcional)">
            <input className="input" placeholder={`${meta.types[type]} — ${tablets.find((t) => t.id === selected[0])?.name ?? 'tablet'}`} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        )}
        <Field label="Notas">
          <textarea className="input min-h-[70px]" placeholder="Qué pasa, qué hay que llevar…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm">
          <input type="checkbox" checked={workshop} onChange={(e) => setWorkshop(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--accent-strong)]" />
          <span>
            <span className="font-medium">Poner la tablet en taller mientras dure</span>
            <span className="block text-xs text-[var(--muted)]">No cuenta como caída en el Monitor ni manda avisos de WhatsApp. Vuelve sola a activa al cerrar la orden.</span>
          </span>
        </label>
        {checklist.length > 0 && (
          <p className="text-xs text-[var(--muted)]">Checklist: {checklist.join(' · ')}</p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Btn v="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn v="primary" icon="plus" onClick={submit} disabled={saving || !selected.length}>
            {saving ? 'Creando…' : selected.length > 1 ? `Crear ${selected.length} órdenes` : 'Crear orden'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

// ── Cambio de tablet ───────────────────────────────────────────────────
export function SwapModal({ tablets, fromId, orderId, onClose, onDone }: {
  tablets: TabletMonitorEntry[]; fromId?: number; orderId?: number; onClose: () => void; onDone: () => void;
}) {
  const { show } = useToast();
  const [from, setFrom] = useState<number | ''>(fromId ?? '');
  const [to, setTo] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const fromT = tablets.find((t) => t.id === from);
  const toT = tablets.find((t) => t.id === to);
  // Las sin playlist primero: suelen ser las de reserva.
  const spares = useMemo(() => [...tablets].filter((t) => t.id !== from)
    .sort((a, b) => Number(!!a.playlist) - Number(!!b.playlist) || a.name.localeCompare(b.name)), [tablets, from]);

  const submit = async () => {
    if (!from || !to) return;
    setSaving(true);
    try {
      const res = await api.swapTablet({ fromId: from, toId: to, note: note || undefined, orderId });
      show(res.message);
      onDone();
    } catch (e) {
      show(e instanceof Error ? e.message : 'No se pudo hacer el cambio', 'error');
    } finally { setSaving(false); }
  };

  return (
    <Modal title="Cambiar tablet por una de reserva" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tablet que sale (rota)">
            <select className="input" value={from} onChange={(e) => setFrom(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Elegir…</option>
              {tablets.map((t) => <option key={t.id} value={t.id}>{t.name}{t.zone ? ` · ${t.zone}` : ''}</option>)}
            </select>
          </Field>
          <Field label="Tablet de reserva que entra">
            <select className="input" value={to} onChange={(e) => setTo(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Elegir…</option>
              {spares.map((t) => <option key={t.id} value={t.id}>{t.name}{!t.playlist ? ' (sin playlist)' : ''}{t.appVersion ? ` · v${t.appVersion}` : ''}</option>)}
            </select>
          </Field>
        </div>
        {fromT && toT && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 text-sm">
            <p className="mb-2 font-medium">Qué va a pasar</p>
            <ul className="list-disc space-y-1 pl-5 text-[var(--text-2)]">
              <li><b>{toT.name}</b> pasa a llamarse <b>{fromT.name}</b> y toma su playlist ({fromT.playlist?.name ?? 'ninguna'}), zona, grupo, taxista y matrícula.</li>
              <li><b>{fromT.name}</b> pasa a llamarse <b>{fromT.name} (taller)</b>, queda en taller y con una orden de revisión abierta.</li>
              <li>No se borra nada: las reproducciones e historial de cada tablet física quedan con ella.</li>
              <li>La reserva baja la playlist en su próxima conexión.</li>
            </ul>
            {toT.playlist && <p className="mt-2 text-xs text-[var(--warn)]">Ojo: {toT.name} hoy tiene la playlist “{toT.playlist.name}”. Se reemplaza.</p>}
          </div>
        )}
        <Field label="Nota (opcional)">
          <input className="input" placeholder="Ej.: pantalla rota, no carga…" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Btn v="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn v="primary" icon="transfer" onClick={submit} disabled={saving || !from || !to}>{saving ? 'Cambiando…' : 'Hacer el cambio'}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ── Diagnóstico ────────────────────────────────────────────────────────
const DIAG_LABELS: [string, string, (v: unknown) => string][] = [
  ['storageFreeMb', 'Espacio libre', (v) => `${(Number(v) / 1024).toFixed(1)} GB`],
  ['storageTotalMb', 'Espacio total', (v) => `${(Number(v) / 1024).toFixed(1)} GB`],
  ['playlistMb', 'Videos guardados', (v) => `${v} MB`],
  ['ramFreeMb', 'Memoria libre', (v) => `${v} MB`],
  ['ramTotalMb', 'Memoria total', (v) => `${v} MB`],
  ['batteryPct', 'Batería', (v) => `${v}%`],
  ['batteryHealth', 'Salud de la batería', String],
  ['batteryTempC', 'Temp. batería', (v) => `${v} °C`],
  ['charging', 'Carga', String],
  ['network', 'Red', String],
  ['signalDbm', 'Señal', (v) => `${v} dBm`],
  ['internet', 'Internet', (v) => (v ? 'sí' : 'no')],
  ['uptimeMin', 'Encendida hace', (v) => (Number(v) >= 1440 ? `${Math.floor(Number(v) / 1440)} d` : Number(v) >= 60 ? `${Math.floor(Number(v) / 60)} h` : `${v} min`)],
  ['screenOn', 'Pantalla', (v) => (v ? 'prendida' : 'apagada')],
  ['deviceOwner', 'Kiosco (Device Owner)', (v) => (v ? 'sí' : 'no')],
  ['playerOk', 'Reproductor', (v) => (v ? 'OK' : 'no reproduce')],
  ['ads', 'Anuncios cargados', String],
  ['errorStreak', 'Errores seguidos', String],
  ['playlistVersion', 'Versión de playlist', String],
  ['appVersion', 'App', (v) => `v${v}`],
  ['android', 'Android', String],
  ['deviceClock', 'Reloj de la tablet', (v) => {
    const drift = Math.round((Number(v) - Date.now()) / 60000);
    return Math.abs(drift) <= 2 ? 'en hora' : `${drift > 0 ? '+' : ''}${drift} min`;
  }],
];

// Horas desde una fecha (Infinity si nunca).
const hoursSince = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 3600000 : Infinity);

function Stat({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className={`text-sm font-semibold ${warn ? 'text-[var(--danger)]' : 'text-[var(--text)]'}`}>{value}</p>
    </div>
  );
}

export function DiagnosticModal({ tabletId, tabletName, canManage, onClose }: {
  tabletId: number; tabletName: string; canManage: boolean; onClose: () => void;
}) {
  const { show } = useToast();
  const [d, setD] = useState<MaintDiagnostic | null>(null);
  const [asking, setAsking] = useState(false);
  const load = useCallback(() => {
    api.getMaintDiagnostic(tabletId).then(setD).catch((e) => show(e instanceof Error ? e.message : 'Error', 'error'));
  }, [tabletId, show]);
  useEffect(() => { load(); }, [load]);
  // Mientras hay un pedido pendiente, refrescar cada 10 s.
  useEffect(() => {
    if (!d?.pending) return;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [d?.pending, load]);

  const ask = async () => {
    setAsking(true);
    try { const r = await api.requestMaintDiagnostic(tabletId); show(r.message, 'info'); load(); }
    catch (e) { show(e instanceof Error ? e.message : 'Error', 'error'); }
    finally { setAsking(false); }
  };

  const t = d?.tablet;
  const full = d?.full?.data ?? null;
  return (
    <Modal title={`Diagnóstico — ${tabletName}`} onClose={onClose} wide>
      {!d || !t ? <p className="text-sm text-[var(--muted)]">Cargando…</p> : (
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Último reporte (cada sync)</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Última conexión" value={timeAgo(t.lastSync)} warn={hoursSince(t.lastSync) > 24} />
              <Stat label="Batería" value={t.batteryLevel != null ? `${t.batteryLevel}%` : '—'} warn={t.batteryLevel != null && t.batteryLevel <= 20} />
              <Stat label="Temperatura" value={t.temperatureC != null ? `${Math.round(t.temperatureC)} °C` : '—'} warn={(t.temperatureC ?? 0) >= 45} />
              <Stat label="Reproductor" value={t.onFallback ? 'Video de respaldo' : t.playerOk === false ? 'No reproduce' : t.playerOk ? 'OK' : '—'} warn={t.onFallback === true || t.playerOk === false} />
              <Stat label="App" value={t.appVersion ? `v${t.appVersion}` : '—'} />
              <Stat label="Playlist" value={t.playlist ? `${t.playlist.name} (v${t.playlist.version})` : 'Sin playlist'} />
              <Stat label="Brillo" value={t.brightness != null ? `${t.brightness}%${t.brightnessAuto ? ' auto' : ''}` : '—'} />
              <Stat label="Syncs 24 h" value={`${d.syncs24h.total}${d.syncs24h.failed ? ` (${d.syncs24h.failed} fallidos)` : ''}`} warn={d.syncs24h.failed > 0} />
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">{[t.deviceModel, t.osVersion && `Android ${t.osVersion}`, t.serial && `Serie ${t.serial}`, t.lastIp && `IP ${t.lastIp}`].filter(Boolean).join(' · ')}</p>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Diagnóstico completo {d.full && <span className="normal-case tracking-normal">· {timeAgo(d.full.at)}</span>}
              </p>
              {canManage && (
                <Btn size="sm" v="accent" icon="refresh" onClick={ask} disabled={asking || d.pending}>
                  {d.pending ? 'Esperando a la tablet…' : 'Pedir diagnóstico'}
                </Btn>
              )}
            </div>
            {!d.supportsFull && (
              <p className="mb-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-xs text-[var(--warn)]">
                Esta tablet tiene la app v{t.appVersion ?? '?'}. El diagnóstico completo (espacio, memoria, salud de batería, señal) necesita la v1.48 o más nueva.
              </p>
            )}
            {full ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {DIAG_LABELS.filter(([k]) => full[k] !== undefined && full[k] !== null).map(([k, label, fmt]) => (
                  <Stat key={k} label={label} value={fmt(full[k])}
                    warn={(k === 'storageFreeMb' && Number(full[k]) < 1024) || (k === 'ramFreeMb' && Number(full[k]) < 200) ||
                      (k === 'batteryHealth' && full[k] !== 'buena') || (k === 'internet' && !full[k]) || (k === 'playerOk' && !full[k])} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">{d.pending ? 'Pedido enviado. Llega en la próxima conexión de la tablet.' : 'Todavía no se pidió ninguno.'}</p>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Últimos errores de la app</p>
            {d.errors.length ? (
              <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
                {d.errors.map((e, i) => (
                  <li key={i} className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5">
                    <span className="text-[var(--muted)]">{fmtDate(e.occurredAt)} · {e.errorType}</span>
                    <span className="block text-[var(--text-2)]">{e.message}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-[var(--muted)]">Sin errores registrados.</p>}
          </div>
          <div className="flex justify-end">
            <Link href={`/tablets/${tabletId}`} className="text-sm font-medium text-[var(--accent)] hover:underline">Ver ficha de la tablet →</Link>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Historial de una tablet ────────────────────────────────────────────
export function HistoryModal({ tabletId, tabletName, types, onClose }: {
  tabletId: number; tabletName: string; types: Record<string, string>; onClose: () => void;
}) {
  const [orders, setOrders] = useState<MaintOrder[] | null>(null);
  useEffect(() => { api.getMaintTabletHistory(tabletId).then((h) => setOrders(h.orders)).catch(() => setOrders([])); }, [tabletId]);
  return (
    <Modal title={`Historial — ${tabletName}`} onClose={onClose} wide>
      {!orders ? <p className="text-sm text-[var(--muted)]">Cargando…</p> : !orders.length ? (
        <p className="text-sm text-[var(--muted)]">Esta tablet no tiene órdenes de mantenimiento.</p>
      ) : (
        <ol className="relative space-y-3 border-l border-[var(--border)] pl-5">
          {orders.map((o) => (
            <li key={o.id} className="relative">
              <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--surface)] bg-[var(--accent)]" />
              <Link href={`/maintenance/orden/${o.id}`} className="block rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 hover:border-[var(--accent)]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[var(--muted)]">#{o.id}</span>
                  <span className="text-sm font-medium">{o.title}</span>
                  <span className="ml-auto"><StatusChip status={o.status} /></span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {types[o.type] ?? o.type} · {o.completedAt ? `hecha ${fmtDate(o.completedAt)}` : fmtDay(o.scheduledFor)}{o.assignee ? ` · ${o.assignee}` : ''}
                </p>
                {o.resolution && <p className="mt-1 text-xs text-[var(--text-2)]">{o.resolution}</p>}
                <div className="mt-1"><Progress done={o.checklist.filter((c) => c.done).length} total={o.checklist.length} /></div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
