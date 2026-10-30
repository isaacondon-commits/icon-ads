'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, Client, ClientBulkAction, ClientState, clientState } from '@/lib/api';
import ConfirmDialog from '@/components/ConfirmDialog';
import PageShell from '@/components/ui/PageShell';
import UiModal, { Field as UiField } from '@/components/ui/Modal';
import { Btn, BtnLink, IconBtn, TabPill, ViewToggle } from '@/components/ui/buttons';
import ClientPortalAccess from '@/components/ClientPortalAccess';
import { useToast } from '@/lib/toast-context';

const PAGE_SIZE = 10;

const TABS: { id: ClientState; label: string }[] = [
  { id: 'active', label: 'Activos' },
  { id: 'paused', label: 'Pausados' },
  { id: 'off', label: 'Desactivados' },
];

const STATE_BADGE: Record<ClientState, { label: string; color: string }> = {
  active: { label: 'Activo', color: 'var(--ok)' },
  paused: { label: 'Pausado', color: 'var(--warn)' },
  off: { label: 'Desactivado', color: 'var(--muted-2)' },
};

const ACTION_TEXT: Record<ClientBulkAction, { verb: string; done: string; explain: string }> = {
  pause: { verb: 'Pausar', done: 'pausado', explain: 'Sus anuncios dejan de salir en las tablets. Pueden seguir entrando a su portal y ver sus estadísticas.' },
  resume: { verb: 'Reanudar', done: 'reanudado', explain: 'Sus anuncios aprobados vuelven a salir en las tablets.' },
  deactivate: { verb: 'Desactivar', done: 'desactivado', explain: 'Sus anuncios dejan de salir y se les corta el acceso al portal.' },
  reactivate: { verb: 'Reactivar', done: 'reactivado', explain: 'Vuelven a quedar activos: sus anuncios aprobados salen de nuevo y recuperan el portal (tienen que volver a entrar).' },
};

// Acciones posibles según la pestaña.
const TAB_ACTIONS: Record<ClientState, ClientBulkAction[]> = {
  active: ['pause', 'deactivate'],
  paused: ['resume', 'deactivate'],
  off: ['reactivate'],
};

export default function ClientsPage() {
  const { show } = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', rut: '', address: '', color: '', contactName: '', contactPhone: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<ClientState>('active');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState<{ action: ClientBulkAction; ids: number[]; names: string[] } | null>(null);
  const [acting, setActing] = useState(false);
  const [search, setSearch] = useState(() => typeof window !== 'undefined' ? (localStorage.getItem('clients_filter_search') ?? '') : '');  // #6 + #14
  const [page, setPage] = useState(1);       // #8
  const [viewMode, setViewMode] = useState<'table' | 'cards'>(() =>
    typeof window !== 'undefined' ? ((localStorage.getItem('clients_view') as 'table' | 'cards') ?? 'table') : 'table'
  );

  const load = () => api.getClients(true).then(setClients).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const n: Record<ClientState, number> = { active: 0, paused: 0, off: 0 };
    for (const c of clients) n[clientState(c)]++;
    return n;
  }, [clients]);

  const filtered = clients.filter((c) => {
    if (clientState(c) !== tab) return false;
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.company ?? '').toLowerCase().includes(q)
    );
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', email: '', phone: '', company: '', rut: '', address: '', color: '', contactName: '', contactPhone: '' });
    setError('');
    setShowModal(true);
  };

  const openEdit = (c: Client) => {
    setEditing(c);
    setForm({ name: c.name, email: c.email, phone: c.phone ?? '', company: c.company ?? '', rut: c.rut ?? '', address: c.address ?? '', color: c.color ?? '', contactName: c.contactName ?? '', contactPhone: c.contactPhone ?? '' });
    setError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const data = { name: form.name, email: form.email, phone: form.phone || undefined, company: form.company || undefined, rut: form.rut || null, address: form.address || null, color: form.color || null, contactName: form.contactName || null, contactPhone: form.contactPhone || null };
      if (editing) await api.updateClient(editing.id, data);
      else {
        const created = await api.createClient(data);
        const inv = created.portalInvite;
        if (inv?.sent) show(`Cliente creado. Le llegó la invitación al portal a ${created.email}.`);
        else show(`Cliente creado, pero la invitación al portal no salió: ${inv?.error ?? 'error desconocido'}. Podés reenviarla desde Editar.`, 'warning');
      }
      setShowModal(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  const changeTab = (t: ClientState) => { setTab(t); setPage(1); setSelected(new Set()); };
  const toggle = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allPageSelected = paged.length > 0 && paged.every((c) => selected.has(c.id));
  const toggleAllPage = () => setSelected((prev) => {
    const next = new Set(prev);
    for (const c of paged) { if (allPageSelected) next.delete(c.id); else next.add(c.id); }
    return next;
  });

  // Pide confirmación (con la lista de nombres) antes de cambiar el estado.
  const ask = (action: ClientBulkAction, list: Client[]) =>
    setConfirm({ action, ids: list.map((c) => c.id), names: list.map((c) => c.name) });

  const runAction = async () => {
    if (!confirm) return;
    setActing(true);
    try {
      const { changed } = await api.bulkClients(confirm.ids, confirm.action);
      show(`${changed} ${changed === 1 ? 'cliente' : 'clientes'} ${ACTION_TEXT[confirm.action].done}${changed === 1 ? '' : 's'}.`);
      setSelected(new Set());
      await load();
    } catch (e) {
      show(e instanceof Error ? e.message : 'No se pudo cambiar el estado', 'error');
    } finally {
      setActing(false);
      setConfirm(null);
    }
  };

  const selectedClients = clients.filter((c) => selected.has(c.id));

  const rowActions = (c: Client, size?: 'sm') => {
    const st = clientState(c);
    return (
      <>
        {st !== 'off' && (size ? <Btn size="sm" icon="edit" onClick={() => openEdit(c)}>Editar</Btn> : <IconBtn icon="edit" label="Editar" onClick={() => openEdit(c)} />)}
        {size ? <BtnLink size="sm" icon="user" v="accent" href={`/clients/${c.id}`}>Perfil</BtnLink> : <IconBtn icon="user" label="Perfil" href={`/clients/${c.id}`} />}
        <span className={size ? 'ml-auto flex gap-1.5' : 'contents'}>
          {st === 'active' && <IconBtn icon="pause" v="warn" label="Pausar" onClick={() => ask('pause', [c])} />}
          {st === 'paused' && <IconBtn icon="play" v="ok" label="Reanudar" onClick={() => ask('resume', [c])} />}
          {st !== 'off' && <IconBtn icon="x" v="danger" label="Desactivar" onClick={() => ask('deactivate', [c])} />}
          {st === 'off' && <IconBtn icon="refresh" v="ok" label="Reactivar" onClick={() => ask('reactivate', [c])} />}
        </span>
      </>
    );
  };

  return (
    <PageShell
      title="Clientes"
      subtitle={loading ? 'Cargando…' : `${counts.active} activos · ${counts.paused} pausados · ${counts.off} desactivados`}
      actions={(
        <>
          <ViewToggle value={viewMode} onChange={(v) => { setViewMode(v as 'table' | 'cards'); localStorage.setItem('clients_view', v); }}
            options={[{ value: 'table', icon: 'list', label: 'Vista tabla' }, { value: 'cards', icon: 'grid', label: 'Vista tarjetas' }]} />
          <Btn icon="plus" v="primary" onClick={openCreate}>Nuevo cliente</Btn>
        </>
      )}
    >
      {/* Estados */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <TabPill key={t.id} active={tab === t.id} count={counts[t.id]} onClick={() => changeTab(t.id)}>{t.label}</TabPill>
        ))}
      </div>

      {/* #6 — search */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          className="input max-w-xs"
          placeholder="Buscar por nombre, email o empresa..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); localStorage.setItem('clients_filter_search', e.target.value); setPage(1); }}
        />
        {paged.length > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--text-2)]">
            <input type="checkbox" checked={allPageSelected} onChange={toggleAllPage} className="h-4 w-4 accent-red-600" />
            Seleccionar esta página
          </label>
        )}
      </div>

      {/* Acciones en lote */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-20 mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 shadow-lg">
          <span className="text-sm font-medium">{selected.size} {selected.size === 1 ? 'seleccionado' : 'seleccionados'}</span>
          <span className="ml-auto flex flex-wrap gap-2">
            {TAB_ACTIONS[tab].map((a) => (
              <Btn key={a} size="sm" v={a === 'deactivate' ? 'danger' : a === 'pause' ? 'warn' : 'ok'}
                icon={a === 'pause' ? 'pause' : a === 'resume' ? 'play' : a === 'deactivate' ? 'x' : 'refresh'}
                onClick={() => ask(a, selectedClients)}>{ACTION_TEXT[a].verb}</Btn>
            ))}
            <Btn size="sm" v="ghost" onClick={() => setSelected(new Set())}>Limpiar</Btn>
          </span>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Cargando...</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-500">{search ? 'Sin resultados.' : tab === 'active' ? 'No hay clientes activos.' : tab === 'paused' ? 'No hay clientes pausados.' : 'No hay clientes desactivados.'}</p>
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {paged.map((c) => (
            <div key={c.id} className={`card p-5 ${selected.has(c.id) ? 'ring-2 ring-red-400' : ''}`}>
              <div className="flex items-start gap-3 mb-3">
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Seleccionar ${c.name}`} className="mt-3 h-4 w-4 shrink-0 accent-red-600" />
                {c.color ? (
                  <div className="w-10 h-10 rounded-lg shrink-0 border border-black/10" style={{ background: c.color }} />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-lg font-bold text-[var(--accent)]">
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <Link href={`/clients/${c.id}`} className="block truncate text-sm font-semibold text-[var(--text)] hover:text-[var(--accent)]">{c.name}</Link>
                  <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{c.company ?? c.email}</p>
                </div>
                <StateBadge c={c} />
              </div>
              <div className="space-y-1 text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                {c.phone && <p>{c.phone}</p>}
                {c.contactName && <p>{c.contactName}{c.contactPhone ? ` · ${c.contactPhone}` : ''}</p>}
              </div>
              <div className="flex items-center gap-1.5 border-t border-[var(--divider)] pt-3">
                {rowActions(c, 'sm')}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--divider)]">
                <th className="w-10 pl-5 py-3">
                  <input type="checkbox" checked={allPageSelected} onChange={toggleAllPage} aria-label="Seleccionar esta página" className="h-4 w-4 accent-red-600" />
                </th>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Nombre</th>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Email</th>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Empresa</th>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Teléfono</th>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Estado</th>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Editado</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {paged.map((c) => (
                <tr key={c.id} className={`border-b border-[var(--divider)] last:border-b-0 ${selected.has(c.id) ? 'bg-red-50/70 dark:bg-red-950/30' : ''}`}>
                  <td className="w-10 pl-5 py-3">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Seleccionar ${c.name}`} className="h-4 w-4 accent-red-600" />
                  </td>
                  <td className="px-5 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      {c.color && <span className="w-3 h-3 rounded-full shrink-0 border border-black/10" style={{ background: c.color }} />}
                      <Link href={`/clients/${c.id}`} className="font-semibold text-[var(--text)] hover:text-[var(--accent)]">{c.name}</Link>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-gray-500">{c.email}</td>
                  <td className="px-5 py-3" style={{ color: 'var(--text-muted)' }}>
                    <div>{c.company ?? '—'}</div>
                    {/* #17 — commercial contact */}
                    {c.contactName && (
                      <div className="text-xs mt-0.5" style={{ color: 'var(--text-xs)' }}>
                        {c.contactName}{c.contactPhone ? ` · ${c.contactPhone}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3" style={{ color: 'var(--text-muted)' }}>{c.phone ?? '—'}</td>
                  <td className="px-5 py-3">
                    <StateBadge c={c} />
                  </td>
                  <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-xs)' }}>
                    {new Date(c.updatedAt).toLocaleDateString('es-AR')}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {rowActions(c)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* #8 — pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-[var(--muted)]">
          <span>{filtered.length} clientes · página {page} de {totalPages}</span>
          <div className="flex gap-2">
            <Btn size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>‹ Anterior</Btn>
            <Btn size="sm" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>Siguiente ›</Btn>
          </div>
        </div>
      )}

      {/* #9 — confirm */}
      {confirm && (
        <ConfirmDialog
          title={`${ACTION_TEXT[confirm.action].verb} ${confirm.ids.length === 1 ? 'cliente' : `${confirm.ids.length} clientes`}`}
          message={`${confirm.names.length <= 5 ? confirm.names.join(', ') : `${confirm.names.slice(0, 5).join(', ')} y ${confirm.names.length - 5} más`}. ${ACTION_TEXT[confirm.action].explain}`}
          confirmLabel={acting ? 'Un momento…' : ACTION_TEXT[confirm.action].verb}
          onConfirm={runAction}
          onCancel={() => !acting && setConfirm(null)}
        />
      )}

      {showModal && (
        <Modal title={editing ? 'Editar cliente' : 'Nuevo cliente'} onClose={() => setShowModal(false)} closeOnBackdrop={false}>
          <div className="space-y-4">
            <Field label="Nombre"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Email"><input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Empresa (opcional)"><input className="input" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></Field>
            <Field label="Teléfono (opcional)"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="RUT (opcional)"><input className="input" value={form.rut} onChange={(e) => setForm({ ...form, rut: e.target.value })} placeholder="12.345.678-9" /></Field>
            <Field label="Dirección (opcional)"><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Calle 123, Ciudad" /></Field>
            <Field label="Color identificador (opcional)">
              <div className="flex items-center gap-3">
                <input type="color" className="w-10 h-9 rounded cursor-pointer border border-gray-200 p-0.5" value={form.color || '#6366f1'} onChange={(e) => setForm({ ...form, color: e.target.value })} />
                <input className="input flex-1" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} placeholder="#6366f1 o vacío" />
                {form.color && <button type="button" className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setForm({ ...form, color: '' })}>✕</button>}
              </div>
            </Field>
            {/* #17 — commercial contact */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Contacto comercial (opcional)">
                <input className="input" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} placeholder="Nombre del contacto" />
              </Field>
              <Field label="Tel. contacto (opcional)">
                <input className="input" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} placeholder="+598 99 000 000" />
              </Field>
            </div>
            {editing
              ? <ClientPortalAccess clientId={editing.id} />
              : <p className="text-xs text-[var(--muted)]">Al guardar, le llega al email del cliente una invitación al portal de estadísticas (desde empresasiconads@gmail.com).</p>}
            {editing && form.email.trim().toLowerCase() !== editing.email.trim().toLowerCase() && (
              <p className="text-xs text-[var(--warn)]">Cambiar el email cambia el usuario del portal: se cierran sus sesiones y hay que reenviarle la invitación.</p>
            )}
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="sticky bottom-0 flex gap-2 bg-[var(--surface)] pb-1 pt-4 [&>button]:flex-1 [&>button]:justify-center">
              <Btn v="primary" onClick={handleSave} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Btn>
              <Btn onClick={() => setShowModal(false)}>Cancelar</Btn>
            </div>
          </div>
        </Modal>
      )}
    </PageShell>
  );
}

function StateBadge({ c }: { c: Client }) {
  const b = STATE_BADGE[clientState(c)];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-0.5 text-xs text-[var(--text-2)]">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: b.color }} />
      {b.label}
    </span>
  );
}

function Modal(props: { title: string; children: React.ReactNode; onClose: () => void; closeOnBackdrop?: boolean }) {
  return <UiModal {...props} />;
}

function Field(props: { label: string; children: React.ReactNode }) {
  return <UiField {...props} />;
}
