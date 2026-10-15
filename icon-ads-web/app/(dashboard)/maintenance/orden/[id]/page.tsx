'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import PageShell from '@/components/ui/PageShell';
import { Btn, Ico } from '@/components/ui/buttons';
import ConfirmDialog from '@/components/ConfirmDialog';
import {
  api, MaintChecklistItem, MaintMeta, MaintOrder, MaintPart, MaintPhoto, MaintPriority, MaintStatus, TabletMonitorEntry,
} from '@/lib/api';
import { useRole } from '@/lib/roles';
import { useToast } from '@/lib/toast-context';
import { DiagnosticModal, HistoryModal, SwapModal } from '@/components/maintenance/modals';
import {
  Chip, PRIORITY_LABEL, PriorityChip, Progress, SOURCE_LABEL, StatusChip, fmtDate, fromLocalInput, isOpen, isOverdue, toLocalInput,
} from '@/components/maintenance/shared';

// Achica la foto del celular antes de subirla (máx. 1600 px, JPEG).
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    return blob ?? file;
  } catch { return file; }
}

const KIND_LABEL: Record<MaintPhoto['kind'], string> = { antes: 'Antes', despues: 'Después', otra: 'Otra' };

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function MaintOrderPage() {
  const { id } = useParams<{ id: string }>();
  const orderId = Number(id);
  const { show } = useToast();
  const { canManage } = useRole();
  const [o, setO] = useState<MaintOrder | null>(null);
  const [meta, setMeta] = useState<MaintMeta | null>(null);
  const [parts, setParts] = useState<MaintPart[]>([]);
  const [tablets, setTablets] = useState<TabletMonitorEntry[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDone, setConfirmDone] = useState(false);
  const [modal, setModal] = useState<'diag' | 'history' | 'swap' | null>(null);
  const [notes, setNotes] = useState('');
  const [resolution, setResolution] = useState('');
  const [newItem, setNewItem] = useState('');
  const [partPick, setPartPick] = useState({ partId: '', qty: '1' });
  const [uploading, setUploading] = useState<MaintPhoto['kind'] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const kindRef = useRef<MaintPhoto['kind']>('antes');

  const load = useCallback(() => {
    api.getMaintOrder(orderId).then((x) => { setO(x); setNotes(x.notes ?? ''); setResolution(x.resolution ?? ''); })
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar'));
  }, [orderId]);
  useEffect(() => {
    load();
    api.getMaintMeta().then(setMeta).catch(() => {});
    api.getMaintParts().then(setParts).catch(() => {});
    api.getTabletMonitor().then(setTablets).catch(() => {});
  }, [load]);

  const patch = async (data: Parameters<typeof api.updateMaintOrder>[1], msg?: string) => {
    setBusy(true);
    try {
      const x = await api.updateMaintOrder(orderId, data);
      setO(x);
      if (data.notes !== undefined) setNotes(x.notes ?? '');
      if (data.resolution !== undefined) setResolution(x.resolution ?? '');
      if (msg) show(msg);
      return x;
    } catch (e) {
      show(e instanceof Error ? e.message : 'No se pudo guardar', 'error');
      load();
    } finally { setBusy(false); }
  };

  if (error) return <PageShell title="Orden de mantenimiento"><p className="text-sm text-[var(--danger)]">{error}</p></PageShell>;
  if (!o) return <PageShell title="Orden de mantenimiento"><p className="text-sm text-[var(--muted)]">Cargando…</p></PageShell>;

  const types = meta?.types ?? {};
  const open = isOpen(o);
  const editable = canManage && open;
  const pending = o.checklist.filter((c) => !c.done).length;

  const setStatus = (status: MaintStatus) => {
    const msg = { pendiente: 'Orden reabierta', en_curso: 'Orden en curso', hecha: 'Orden terminada', cancelada: 'Orden cancelada' }[status];
    return patch({ status, ...(status === 'hecha' ? { notes, resolution } : {}) }, msg);
  };
  const toggleItem = (i: number) => {
    const checklist: MaintChecklistItem[] = o.checklist.map((c, j) => (j === i ? { ...c, done: !c.done } : c));
    setO({ ...o, checklist });
    patch({ checklist });
  };
  const addItem = () => {
    if (!newItem.trim()) return;
    patch({ checklist: [...o.checklist, { label: newItem.trim(), done: false }] });
    setNewItem('');
  };
  const pickPhoto = (kind: MaintPhoto['kind']) => { kindRef.current = kind; fileRef.current?.click(); };
  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!files.length) return;
    const kind = kindRef.current;
    setUploading(kind);
    try {
      const added: MaintPhoto[] = [];
      for (const f of files) {
        const blob = await shrink(f);
        const up = await api.uploadMaintPhoto(blob, `foto-${Date.now()}.jpg`);
        added.push({ url: up.url, key: up.key, kind, at: new Date().toISOString() });
      }
      await patch({ photos: [...o.photos, ...added] }, added.length === 1 ? 'Foto agregada' : `${added.length} fotos agregadas`);
    } catch (err) {
      show(err instanceof Error ? err.message : 'No se pudo subir la foto', 'error');
    } finally { setUploading(null); }
  };
  const addPart = () => {
    const pid = Number(partPick.partId);
    const qty = Math.max(1, parseInt(partPick.qty) || 1);
    if (!pid) return;
    const p = parts.find((x) => x.id === pid);
    const existing = o.parts.find((x) => x.partId === pid);
    const next = existing ? o.parts.map((x) => (x.partId === pid ? { ...x, qty: x.qty + qty } : x)) : [...o.parts, { partId: pid, qty, name: p?.name }];
    patch({ parts: next });
    setPartPick({ partId: '', qty: '1' });
  };
  const partName = (pid: number, fallback?: string | null) => parts.find((p) => p.id === pid)?.name ?? fallback ?? `Repuesto #${pid}`;

  return (
    <PageShell
      title={o.title}
      subtitle={(
        <span className="inline-flex flex-wrap items-center gap-2">
          <Link href="/maintenance?tab=ordenes" className="text-[var(--accent)] hover:underline">← Mantenimiento</Link>
          <span>· Orden #{o.id} · {types[o.type] ?? o.type}</span>
        </span>
      )}
      actions={(
        <span className="inline-flex flex-wrap items-center gap-2">
          <StatusChip status={o.status} />
          <PriorityChip priority={o.priority} />
          {o.workshop && open && <Chip color="var(--warn)">Tablet en taller</Chip>}
        </span>
      )}>

      {/* Acciones de estado: botones grandes, cómodos en el celular */}
      {canManage && (
        <div className="mb-5 flex flex-wrap gap-2">
          {o.status === 'pendiente' && <Btn v="accent" icon="play" onClick={() => setStatus('en_curso')} disabled={busy}>Empezar</Btn>}
          {open && <Btn v="ok" icon="check" onClick={() => (pending || o.parts.length) ? setConfirmDone(true) : setStatus('hecha')} disabled={busy}>Marcar como hecha</Btn>}
          {open && <Btn v="danger" icon="x" onClick={() => setStatus('cancelada')} disabled={busy}>Cancelar orden</Btn>}
          {!open && <Btn icon="refresh" onClick={() => setStatus('pendiente')} disabled={busy}>Reabrir</Btn>}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Card title="Checklist" right={<Progress done={o.checklist.length - pending} total={o.checklist.length} />}>
            {!o.checklist.length && <p className="text-sm text-[var(--muted)]">Sin tareas.</p>}
            <ul className="space-y-1.5">
              {o.checklist.map((c, i) => (
                <li key={i}>
                  <label className={`flex min-h-12 items-center gap-3 rounded-xl border border-[var(--border)] px-3 py-2 ${editable ? 'cursor-pointer hover:bg-[var(--surface-hover)]' : ''} ${c.done ? 'bg-[color-mix(in_srgb,var(--ok)_8%,transparent)]' : 'bg-[var(--surface-2)]'}`}>
                    <input type="checkbox" checked={c.done} disabled={!editable} onChange={() => toggleItem(i)} className="h-5 w-5 shrink-0 accent-[var(--ok)]" />
                    <span className={`text-sm ${c.done ? 'text-[var(--muted)] line-through' : ''}`}>{c.label}</span>
                  </label>
                </li>
              ))}
            </ul>
            {editable && (
              <div className="mt-3 flex gap-2">
                <input className="input h-10" placeholder="Agregar tarea…" value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addItem()} />
                <Btn icon="plus" onClick={addItem} disabled={!newItem.trim()}>Agregar</Btn>
              </div>
            )}
          </Card>

          <Card title={`Fotos (${o.photos.length})`} right={canManage && (
            <div className="flex flex-wrap gap-1.5">
              {(['antes', 'despues', 'otra'] as const).map((k) => (
                <Btn key={k} size="sm" v="accent" icon="plus" onClick={() => pickPhoto(k)} disabled={!!uploading}>
                  {uploading === k ? 'Subiendo…' : KIND_LABEL[k]}
                </Btn>
              ))}
            </div>
          )}>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={onPhoto} />
            {!o.photos.length ? <p className="text-sm text-[var(--muted)]">Sin fotos. Sacá una del antes y otra del después.</p> : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {o.photos.map((p, i) => (
                  <figure key={p.url + i} className="group relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)]">
                    <a href={p.url} target="_blank" rel="noreferrer">
                      <img src={p.url} alt={KIND_LABEL[p.kind]} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                    </a>
                    <figcaption className="flex items-center justify-between px-2 py-1 text-xs">
                      <span className="font-medium">{KIND_LABEL[p.kind]}</span>
                      {canManage && (
                        <button type="button" className="text-[var(--muted)] hover:text-[var(--danger)]" title="Quitar de la orden"
                          onClick={() => patch({ photos: o.photos.filter((_, j) => j !== i) }, 'Foto quitada')}>
                          <Ico name="x" className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </Card>

          <Card title="Repuestos usados" right={o.partsApplied && <Chip color="var(--ok)">Descontados del stock</Chip>}>
            {!o.parts.length && <p className="mb-2 text-sm text-[var(--muted)]">Ninguno.</p>}
            <ul className="mb-3 divide-y divide-[var(--divider)]">
              {o.parts.map((p) => (
                <li key={p.partId} className="flex items-center gap-3 py-2 text-sm">
                  <span className="flex-1">{partName(p.partId, p.name)}</span>
                  <span className="font-semibold tabular-nums">× {p.qty}</span>
                  {editable && !o.partsApplied && (
                    <button type="button" className="text-[var(--muted)] hover:text-[var(--danger)]" title="Quitar"
                      onClick={() => patch({ parts: o.parts.filter((x) => x.partId !== p.partId) })}>
                      <Ico name="x" className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {editable && !o.partsApplied && (
              <>
                <div className="flex flex-wrap gap-2">
                  <select className="input h-10 min-w-0 flex-1" value={partPick.partId} onChange={(e) => setPartPick({ ...partPick, partId: e.target.value })}>
                    <option value="">Elegir repuesto…</option>
                    {parts.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} (hay {p.stock})</option>)}
                  </select>
                  <input type="number" min={1} className="input h-10 w-20" value={partPick.qty} onChange={(e) => setPartPick({ ...partPick, qty: e.target.value })} />
                  <Btn icon="plus" onClick={addPart} disabled={!partPick.partId}>Agregar</Btn>
                </div>
                <p className="mt-2 text-xs text-[var(--muted)]">Se descuentan del inventario al marcar la orden como hecha.</p>
              </>
            )}
          </Card>

          <Card title="Notas y resultado">
            <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Notas</label>
            <textarea className="input mb-3 min-h-[80px]" disabled={!canManage} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Qué se hizo / resultado</label>
            <textarea className="input min-h-[80px]" disabled={!canManage} placeholder="Ej.: cambié el cargador, quedó cargando OK" value={resolution} onChange={(e) => setResolution(e.target.value)} />
            {canManage && (notes !== (o.notes ?? '') || resolution !== (o.resolution ?? '')) && (
              <div className="mt-3 flex justify-end"><Btn v="primary" onClick={() => patch({ notes, resolution }, 'Guardado')} disabled={busy}>Guardar</Btn></div>
            )}
          </Card>
        </div>

        <aside className="space-y-5">
          <Card title="Tablet">
            {o.tabletId ? (
              <>
                <Link href={`/tablets/${o.tabletId}`} className="text-lg font-semibold hover:underline">{tablets.find((t) => t.id === o.tabletId)?.name ?? o.tabletName}</Link>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Btn size="sm" icon="eye" onClick={() => setModal('diag')}>Diagnóstico</Btn>
                  <Btn size="sm" icon="list" onClick={() => setModal('history')}>Historial</Btn>
                  {canManage && open && <Btn size="sm" icon="transfer" onClick={() => setModal('swap')}>Cambiar tablet</Btn>}
                </div>
              </>
            ) : <p className="text-sm text-[var(--muted)]">{o.tabletName ? `${o.tabletName} (ya no existe)` : 'Sin tablet'}</p>}
          </Card>

          <Card title="Datos">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-[var(--muted)]">Fecha</dt>
                {editable ? (
                  <input type="datetime-local" className="input mt-1 h-10" value={toLocalInput(o.scheduledFor)} onChange={(e) => patch({ scheduledFor: fromLocalInput(e.target.value) })} />
                ) : <dd className={isOverdue(o) ? 'font-semibold text-[var(--danger)]' : ''}>{fmtDate(o.scheduledFor)}</dd>}
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">Responsable</dt>
                {editable ? (
                  <input className="input mt-1 h-10" defaultValue={o.assignee ?? ''} placeholder="Sin asignar"
                    onBlur={(e) => e.target.value !== (o.assignee ?? '') && patch({ assignee: e.target.value || null }, 'Responsable actualizado')} />
                ) : <dd>{o.assignee ?? 'Sin asignar'}</dd>}
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">Prioridad</dt>
                {editable && meta ? (
                  <select className="input mt-1 h-10" value={o.priority} onChange={(e) => patch({ priority: e.target.value as MaintPriority })}>
                    {meta.priorities.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                  </select>
                ) : <dd>{PRIORITY_LABEL[o.priority]}</dd>}
              </div>
              {editable && o.tabletId && (
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
                  <input type="checkbox" checked={o.workshop} onChange={(e) => patch({ workshop: e.target.checked }, e.target.checked ? 'Tablet en taller' : 'Tablet fuera de taller')} className="mt-0.5 h-4 w-4 accent-[var(--accent-strong)]" />
                  <span><span className="font-medium">Tablet en taller</span><span className="block text-xs text-[var(--muted)]">No alerta ni cuenta como caída mientras la orden esté abierta.</span></span>
                </label>
              )}
              <div><dt className="text-xs text-[var(--muted)]">Origen</dt><dd>{SOURCE_LABEL[o.source] ?? o.source}{o.createdBy ? ` · ${o.createdBy}` : ''}</dd></div>
              <div><dt className="text-xs text-[var(--muted)]">Creada</dt><dd>{fmtDate(o.createdAt)}</dd></div>
              {o.startedAt && <div><dt className="text-xs text-[var(--muted)]">Empezada</dt><dd>{fmtDate(o.startedAt)}</dd></div>}
              {o.completedAt && <div><dt className="text-xs text-[var(--muted)]">Terminada</dt><dd>{fmtDate(o.completedAt)}</dd></div>}
            </dl>
          </Card>
        </aside>
      </div>

      {confirmDone && (
        <ConfirmDialog title="¿Marcar como hecha?"
          message={[
            pending ? `Quedan ${pending} tarea(s) del checklist sin tildar.` : '',
            o.parts.length ? `Se descuentan del stock: ${o.parts.map((p) => `${partName(p.partId, p.name)} × ${p.qty}`).join(', ')}.` : '',
          ].filter(Boolean).join(' ')}
          confirmLabel="Sí, terminar"
          onConfirm={() => { setConfirmDone(false); setStatus('hecha'); }}
          onCancel={() => setConfirmDone(false)} />
      )}
      {modal === 'diag' && o.tabletId && <DiagnosticModal tabletId={o.tabletId} tabletName={o.tabletName ?? ''} canManage={canManage} onClose={() => setModal(null)} />}
      {modal === 'history' && o.tabletId && <HistoryModal tabletId={o.tabletId} tabletName={o.tabletName ?? ''} types={types} onClose={() => setModal(null)} />}
      {modal === 'swap' && o.tabletId && (
        <SwapModal tablets={tablets} fromId={o.tabletId} orderId={o.id} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />
      )}
    </PageShell>
  );
}
