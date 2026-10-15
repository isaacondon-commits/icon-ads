'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Modal, { Field } from '@/components/ui/Modal';
import { Btn, IconBtn } from '@/components/ui/buttons';
import { api, MaintMeta, MaintPart, MaintRule, MaintRuleInput, TabletGroup, TabletMonitorEntry } from '@/lib/api';
import { useToast } from '@/lib/toast-context';
import { Chip, Empty, SectionTitle, fmtDate, timeAgo, toLocalInput, fromLocalInput } from './shared';

// ── Repuestos ──────────────────────────────────────────────────────────
export function PartsTab({ parts, canManage, onChanged }: { parts: MaintPart[] | null; canManage: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState<MaintPart | 'new' | null>(null);
  const [moving, setMoving] = useState<{ part: MaintPart; dir: 1 | -1 } | null>(null);
  const [history, setHistory] = useState<MaintPart | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  if (!parts) return <Empty>Cargando…</Empty>;
  const list = parts.filter((p) => showArchived || p.active);
  const archived = parts.filter((p) => !p.active).length;
  return (
    <div>
      <SectionTitle right={(
        <div className="flex items-center gap-2">
          {archived > 0 && <Btn size="sm" v="ghost" onClick={() => setShowArchived((v) => !v)}>{showArchived ? 'Ocultar archivados' : `Ver archivados (${archived})`}</Btn>}
          {canManage && <Btn size="sm" v="primary" icon="plus" onClick={() => setEditing('new')}>Nuevo repuesto</Btn>}
        </div>
      )}>Inventario de repuestos</SectionTitle>
      {!list.length ? <Empty>Todavía no cargaste repuestos. Sumá cargadores, cables, soportes y tablets de reserva.</Empty> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <div key={p.id} className={`card p-4 ${p.active ? '' : 'opacity-60'}`} style={p.low ? { borderColor: 'var(--danger-border)' } : undefined}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-xs text-[var(--muted)]">{[p.category, p.notes].filter(Boolean).join(' · ') || ' '}</p>
                </div>
                {!p.active && <Chip color="var(--muted)">Archivado</Chip>}
                {p.low && <Chip color="var(--danger)">Stock bajo</Chip>}
              </div>
              <div className="mt-3 flex items-end gap-2">
                <span className={`text-3xl font-bold tabular-nums ${p.low ? 'text-[var(--danger)]' : ''}`}>{p.stock}</span>
                <span className="pb-1 text-sm text-[var(--muted)]">{p.unit} · mínimo {p.minStock}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {canManage && p.active && <Btn size="sm" v="ok" icon="plus" onClick={() => setMoving({ part: p, dir: 1 })}>Entrada</Btn>}
                {canManage && p.active && <Btn size="sm" v="warn" onClick={() => setMoving({ part: p, dir: -1 })}>− Salida</Btn>}
                <span className="ml-auto flex gap-1.5">
                  <IconBtn icon="list" label="Movimientos" onClick={() => setHistory(p)} />
                  {canManage && <IconBtn icon="edit" label="Editar" onClick={() => setEditing(p)} />}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <PartModal part={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
      {moving && <MoveModal part={moving.part} dir={moving.dir} onClose={() => setMoving(null)} onSaved={() => { setMoving(null); onChanged(); }} />}
      {history && <MovesModal part={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function PartModal({ part, onClose, onSaved }: { part: MaintPart | null; onClose: () => void; onSaved: () => void }) {
  const { show } = useToast();
  const [f, setF] = useState({
    name: part?.name ?? '', category: part?.category ?? '', unit: part?.unit ?? 'u',
    stock: '0', minStock: String(part?.minStock ?? 1), notes: part?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      if (part) await api.updateMaintPart(part.id, { name: f.name, category: f.category || null, unit: f.unit, minStock: Number(f.minStock) || 0, notes: f.notes || null });
      else await api.createMaintPart({ name: f.name, category: f.category || null, unit: f.unit, stock: Number(f.stock) || 0, minStock: Number(f.minStock) || 0, notes: f.notes || null });
      show(part ? 'Repuesto actualizado' : 'Repuesto creado');
      onSaved();
    } catch (e) { show(e instanceof Error ? e.message : 'Error', 'error'); } finally { setSaving(false); }
  };
  const archive = async () => {
    if (!part) return;
    try { await api.updateMaintPart(part.id, { active: !part.active }); show(part.active ? 'Repuesto archivado' : 'Repuesto reactivado'); onSaved(); }
    catch (e) { show(e instanceof Error ? e.message : 'Error', 'error'); }
  };
  return (
    <Modal title={part ? `Editar — ${part.name}` : 'Nuevo repuesto'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Nombre"><input className="input" placeholder="Ej.: Cargador 12V USB-C" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Categoría"><input className="input" placeholder="Carga, soporte, tablet…" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
          <Field label="Unidad"><input className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
          {!part && <Field label="Stock inicial"><input type="number" min={0} className="input" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value })} /></Field>}
          <Field label="Avisar cuando queden"><input type="number" min={0} className="input" value={f.minStock} onChange={(e) => setF({ ...f, minStock: e.target.value })} /></Field>
        </div>
        <Field label="Notas"><input className="input" placeholder="Proveedor, modelo…" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {part && <p className="text-xs text-[var(--muted)]">El stock se cambia con Entrada / Salida, así queda registrado.</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {part && <Btn v={part.active ? 'danger' : 'ok'} icon="archive" onClick={archive}>{part.active ? 'Archivar' : 'Reactivar'}</Btn>}
          <span className="flex-1" />
          <Btn v="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn v="primary" onClick={save} disabled={saving || !f.name.trim()}>{saving ? 'Guardando…' : 'Guardar'}</Btn>
        </div>
      </div>
    </Modal>
  );
}

function MoveModal({ part, dir, onClose, onSaved }: { part: MaintPart; dir: 1 | -1; onClose: () => void; onSaved: () => void }) {
  const { show } = useToast();
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const n = Math.abs(parseInt(qty)) || 0;
    if (!n) return;
    setSaving(true);
    try {
      const p = await api.moveMaintPart(part.id, n * dir, reason || (dir > 0 ? 'Compra / entrada' : 'Salida manual'));
      show(`${p.name}: quedan ${p.stock} ${p.unit}`);
      onSaved();
    } catch (e) { show(e instanceof Error ? e.message : 'Error', 'error'); } finally { setSaving(false); }
  };
  return (
    <Modal title={`${dir > 0 ? 'Entrada' : 'Salida'} — ${part.name}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-[var(--muted)]">Hay {part.stock} {part.unit}.</p>
        <Field label="Cantidad"><input type="number" min={1} className="input" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></Field>
        <Field label="Motivo"><input className="input" placeholder={dir > 0 ? 'Compra, devolución…' : 'Roto, prestado…'} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <p className="text-xs text-[var(--muted)]">Lo que se usa en una orden se descuenta solo al marcarla como hecha.</p>
        <div className="flex justify-end gap-2">
          <Btn v="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn v="primary" onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Registrar'}</Btn>
        </div>
      </div>
    </Modal>
  );
}

function MovesModal({ part, onClose }: { part: MaintPart; onClose: () => void }) {
  const [moves, setMoves] = useState<Awaited<ReturnType<typeof api.getMaintPartMoves>> | null>(null);
  useEffect(() => { api.getMaintPartMoves(part.id).then(setMoves).catch(() => setMoves([])); }, [part.id]);
  return (
    <Modal title={`Movimientos — ${part.name}`} onClose={onClose}>
      {!moves ? <p className="text-sm text-[var(--muted)]">Cargando…</p> : !moves.length ? <p className="text-sm text-[var(--muted)]">Sin movimientos.</p> : (
        <ul className="divide-y divide-[var(--divider)]">
          {moves.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-2 text-sm">
              <span className={`w-12 text-right font-semibold tabular-nums ${m.delta > 0 ? 'text-[var(--ok)]' : 'text-[var(--warn)]'}`}>{m.delta > 0 ? '+' : ''}{m.delta}</span>
              <span className="min-w-0 flex-1">
                {m.orderId ? <Link href={`/maintenance/orden/${m.orderId}`} className="text-[var(--accent)] hover:underline">{m.reason}</Link> : m.reason}
                <span className="block text-xs text-[var(--muted)]">{fmtDate(m.createdAt)}{m.createdBy ? ` · ${m.createdBy}` : ''}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// ── Reglas recurrentes ─────────────────────────────────────────────────
export function RulesTab({ rules, meta, tablets, groups, canManage, onChanged }: {
  rules: MaintRule[] | null; meta: MaintMeta; tablets: TabletMonitorEntry[]; groups: TabletGroup[];
  canManage: boolean; onChanged: () => void;
}) {
  const { show } = useToast();
  const [editing, setEditing] = useState<MaintRule | 'new' | null>(null);
  const [running, setRunning] = useState(false);
  if (!rules) return <Empty>Cargando…</Empty>;
  const scopeLabel = (r: MaintRule) => r.scope === 'all' ? 'Toda la flota'
    : r.scope === 'group' ? `Grupo ${groups.find((g) => g.id === r.scopeId)?.name ?? `#${r.scopeId}`}`
      : tablets.find((t) => t.id === r.scopeId)?.name ?? `Tablet #${r.scopeId}`;
  const run = async () => {
    setRunning(true);
    try { const r = await api.runMaintRules(); show(r.created ? `Se crearon ${r.created} órdenes` : 'No había órdenes para crear', 'info'); onChanged(); }
    catch (e) { show(e instanceof Error ? e.message : 'Error', 'error'); } finally { setRunning(false); }
  };
  const toggle = async (r: MaintRule) => {
    try { await api.updateMaintRule(r.id, { active: !r.active }); show(r.active ? 'Regla pausada' : 'Regla activada'); onChanged(); }
    catch (e) { show(e instanceof Error ? e.message : 'Error', 'error'); }
  };
  return (
    <div>
      <SectionTitle right={canManage && (
        <div className="flex gap-2">
          <Btn size="sm" icon="refresh" onClick={run} disabled={running}>{running ? 'Revisando…' : 'Revisar ahora'}</Btn>
          <Btn size="sm" v="primary" icon="plus" onClick={() => setEditing('new')}>Nueva regla</Btn>
        </div>
      )}>Mantenimiento recurrente</SectionTitle>
      <p className="mb-4 text-sm text-[var(--muted)]">
        Cada regla crea sola una orden por tablet cuando se acerca la fecha (se revisa cada hora). La próxima se cuenta desde que se completa la anterior.
      </p>
      {!rules.length ? <Empty>No hay reglas. Ejemplo: “Revisión general cada 60 días para toda la flota”.</Empty> : (
        <div className="card divide-y divide-[var(--divider)] overflow-hidden">
          {rules.map((r) => (
            <div key={r.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 ${r.active ? '' : 'opacity-60'}`}>
              <span className="min-w-0 flex-1 basis-60">
                <span className="block text-sm font-medium">{r.name}</span>
                <span className="block text-xs text-[var(--muted)]">
                  {meta.types[r.type] ?? r.type} · cada {r.everyDays} días · {scopeLabel(r)}{r.assignee ? ` · ${r.assignee}` : ''}
                </span>
              </span>
              <span className="text-xs text-[var(--muted)]">
                {new Date(r.startsAt) > new Date() ? `Arranca ${new Date(r.startsAt).toLocaleDateString('es-UY')}` : `Revisada ${timeAgo(r.lastRunAt)}`}
              </span>
              {r.notify && <Chip color="var(--ok)">Avisa por WhatsApp</Chip>}
              {r.active ? <Chip color="var(--accent)">Activa</Chip> : <Chip color="var(--muted)">Pausada</Chip>}
              {canManage && (
                <span className="flex gap-1.5">
                  <IconBtn icon={r.active ? 'pause' : 'play'} label={r.active ? 'Pausar' : 'Activar'} onClick={() => toggle(r)} />
                  <IconBtn icon="edit" label="Editar" onClick={() => setEditing(r)} />
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {editing && (
        <RuleModal rule={editing === 'new' ? null : editing} meta={meta} tablets={tablets} groups={groups}
          onClose={() => setEditing(null)} onSaved={(n) => { setEditing(null); if (n) show(`Se crearon ${n} órdenes`, 'info'); onChanged(); }} />
      )}
    </div>
  );
}

function RuleModal({ rule, meta, tablets, groups, onClose, onSaved }: {
  rule: MaintRule | null; meta: MaintMeta; tablets: TabletMonitorEntry[]; groups: TabletGroup[];
  onClose: () => void; onSaved: (created: number) => void;
}) {
  const { show } = useToast();
  const [f, setF] = useState(() => ({
    name: rule?.name ?? '', type: rule?.type ?? 'revision', everyDays: String(rule?.everyDays ?? 60), leadDays: String(rule?.leadDays ?? 3),
    scope: rule?.scope ?? 'all', scopeId: rule?.scopeId ? String(rule.scopeId) : '', assignee: rule?.assignee ?? '',
    notify: rule?.notify ?? true, startsAt: toLocalInput(rule?.startsAt ?? new Date(Date.now() + 7 * 86400000).toISOString()).slice(0, 10),
  }));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const data: MaintRuleInput = {
      name: f.name.trim(), type: f.type, everyDays: Number(f.everyDays), leadDays: Number(f.leadDays),
      scope: f.scope as MaintRuleInput['scope'], scopeId: f.scope === 'all' ? null : Number(f.scopeId) || null,
      assignee: f.assignee || null, notify: f.notify, startsAt: fromLocalInput(`${f.startsAt}T09:00`) ?? undefined,
    };
    try {
      const r = rule ? await api.updateMaintRule(rule.id, data) : await api.createMaintRule(data);
      show(rule ? 'Regla actualizada' : 'Regla creada');
      onSaved(r.created);
    } catch (e) { show(e instanceof Error ? e.message : 'Error', 'error'); } finally { setSaving(false); }
  };
  return (
    <Modal title={rule ? 'Editar regla' : 'Nueva regla recurrente'} onClose={onClose} wide>
      <div className="space-y-4">
        <Field label="Nombre"><input className="input" placeholder="Ej.: Revisión general" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Tipo">
            <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {Object.entries(meta.types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Cada cuántos días"><input type="number" min={1} max={730} className="input" value={f.everyDays} onChange={(e) => setF({ ...f, everyDays: e.target.value })} /></Field>
          <Field label="Crear con anticipación (días)"><input type="number" min={0} max={60} className="input" value={f.leadDays} onChange={(e) => setF({ ...f, leadDays: e.target.value })} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Para">
            <select className="input" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as MaintRule['scope'], scopeId: '' })}>
              <option value="all">Toda la flota</option>
              <option value="group">Un grupo</option>
              <option value="tablet">Una tablet</option>
            </select>
          </Field>
          {f.scope === 'group' && (
            <Field label="Grupo">
              <select className="input" value={f.scopeId} onChange={(e) => setF({ ...f, scopeId: e.target.value })}>
                <option value="">Elegir…</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
          )}
          {f.scope === 'tablet' && (
            <Field label="Tablet">
              <select className="input" value={f.scopeId} onChange={(e) => setF({ ...f, scopeId: e.target.value })}>
                <option value="">Elegir…</option>
                {tablets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Primera vez"><input type="date" className="input" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></Field>
          <Field label="Responsable"><input className="input" placeholder="Quién las hace" value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })} /></Field>
        </div>
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <input type="checkbox" checked={f.notify} onChange={(e) => setF({ ...f, notify: e.target.checked })} className="h-4 w-4 accent-[var(--accent-strong)]" />
          Avisar por WhatsApp cuando se creen órdenes
        </label>
        <div className="flex justify-end gap-2">
          <Btn v="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn v="primary" onClick={save} disabled={saving || !f.name.trim() || (f.scope !== 'all' && !f.scopeId)}>{saving ? 'Guardando…' : 'Guardar'}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ── Checklists por tipo ────────────────────────────────────────────────
export function ChecklistsTab({ meta, canManage, onSaved }: { meta: MaintMeta; canManage: boolean; onSaved: (c: Record<string, string[]>) => void }) {
  const { show } = useToast();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.keys(meta.types).map((t) => [t, (meta.checklists[t] ?? []).join('\n')])));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const out = await api.saveMaintChecklists(Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v.split('\n').map((s) => s.trim()).filter(Boolean)])));
      show('Checklists guardados');
      onSaved(out);
    } catch (e) { show(e instanceof Error ? e.message : 'Error', 'error'); } finally { setSaving(false); }
  };
  return (
    <div>
      <SectionTitle right={canManage && <Btn size="sm" v="primary" icon="check" onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar checklists'}</Btn>}>
        Checklist de cada tipo de visita
      </SectionTitle>
      <p className="mb-4 text-sm text-[var(--muted)]">Una tarea por renglón. Las órdenes nuevas copian el checklist de su tipo; las que ya existen no cambian.</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Object.entries(meta.types).map(([k, label]) => (
          <div key={k} className="card p-4">
            <p className="mb-2 text-sm font-semibold">{label}</p>
            <textarea className="input min-h-[140px] text-sm leading-6" disabled={!canManage} value={draft[k] ?? ''}
              onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} placeholder="Sin checklist" />
          </div>
        ))}
      </div>
    </div>
  );
}
