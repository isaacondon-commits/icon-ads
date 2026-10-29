'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, Client } from '@/lib/api';
import ConfirmDialog from '@/components/ConfirmDialog';
import PageShell from '@/components/ui/PageShell';
import UiModal, { Field as UiField } from '@/components/ui/Modal';
import { Btn, BtnLink, IconBtn, ViewToggle } from '@/components/ui/buttons';

const PAGE_SIZE = 10;

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', rut: '', address: '', color: '', contactName: '', contactPhone: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null); // #9
  const [search, setSearch] = useState(() => typeof window !== 'undefined' ? (localStorage.getItem('clients_filter_search') ?? '') : '');  // #6 + #14
  const [page, setPage] = useState(1);       // #8
  const [viewMode, setViewMode] = useState<'table' | 'cards'>(() =>
    typeof window !== 'undefined' ? ((localStorage.getItem('clients_view') as 'table' | 'cards') ?? 'table') : 'table'
  );

  const load = () => api.getClients().then(setClients).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const filtered = clients.filter((c) => {
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
      else await api.createClient(data);
      setShowModal(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await api.deleteClient(deleteTarget.id).catch(() => {});
    setDeleteTarget(null);
    load();
  };

  const activeClients = clients.filter((c) => c.active).length;

  return (
    <PageShell
      title="Clientes"
      subtitle={loading ? 'Cargando…' : `${clients.length} clientes · ${activeClients} activos`}
      actions={(
        <>
          <ViewToggle value={viewMode} onChange={(v) => { setViewMode(v as 'table' | 'cards'); localStorage.setItem('clients_view', v); }}
            options={[{ value: 'table', icon: 'list', label: 'Vista tabla' }, { value: 'cards', icon: 'grid', label: 'Vista tarjetas' }]} />
          <Btn icon="plus" v="primary" onClick={openCreate}>Nuevo cliente</Btn>
        </>
      )}
    >
      {/* #6 — search */}
      <div className="mb-4">
        <input
          className="input max-w-xs"
          placeholder="Buscar por nombre, email o empresa..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); localStorage.setItem('clients_filter_search', e.target.value); setPage(1); }}
        />
      </div>

      {loading ? (
        <p className="text-gray-500">Cargando...</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-500">{search ? 'Sin resultados.' : 'No hay clientes.'}</p>
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {paged.map((c) => (
            <div key={c.id} className="card p-5">
              <div className="flex items-start gap-3 mb-3">
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
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${c.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'}`}>
                  {c.active ? 'Activo' : 'Inactivo'}
                </span>
              </div>
              <div className="space-y-1 text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                {c.phone && <p>{c.phone}</p>}
                {c.contactName && <p>{c.contactName}{c.contactPhone ? ` · ${c.contactPhone}` : ''}</p>}
              </div>
              <div className="flex items-center gap-1.5 border-t border-[var(--divider)] pt-3">
                <Btn size="sm" icon="edit" onClick={() => openEdit(c)}>Editar</Btn>
                <BtnLink size="sm" icon="user" v="accent" href={`/clients/${c.id}`}>Perfil</BtnLink>
                <span className="ml-auto"><IconBtn icon="x" v="danger" label="Desactivar" onClick={() => setDeleteTarget(c)} /></span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--divider)]">
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
                <tr key={c.id} className="border-b border-[var(--divider)] last:border-b-0">
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
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-0.5 text-xs text-[var(--text-2)]">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.active ? 'var(--ok)' : 'var(--muted-2)' }} />
                      {c.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-xs)' }}>
                    {new Date(c.updatedAt).toLocaleDateString('es-AR')}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <IconBtn icon="edit" label="Editar" onClick={() => openEdit(c)} />
                      <IconBtn icon="user" label="Perfil" href={`/clients/${c.id}`} />
                      <IconBtn icon="x" v="danger" label="Desactivar" onClick={() => setDeleteTarget(c)} />
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
      {deleteTarget && (
        <ConfirmDialog
          title="Desactivar cliente"
          message={`¿Desactivar a "${deleteTarget.name}"?`}
          confirmLabel="Desactivar"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
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

function Modal(props: { title: string; children: React.ReactNode; onClose: () => void; closeOnBackdrop?: boolean }) {
  return <UiModal {...props} />;
}

function Field(props: { label: string; children: React.ReactNode }) {
  return <UiField {...props} />;
}
