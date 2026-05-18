'use client';

import { useEffect, useState } from 'react';
import { api, Campaign, Client } from '@/lib/api';
import ConfirmDialog from '@/components/ConfirmDialog';

const PAGE_SIZE = 10;

function daysLeft(endDate: string): number {
  return Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000);
}

function DaysLeftBadge({ endDate, active }: { endDate: string; active: boolean }) {
  if (!active) return null;
  const days = daysLeft(endDate);
  if (days < 0) return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">Vencida</span>;
  // #32 — warning if < 3 days left
  if (days <= 3) return <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-600 font-medium animate-pulse">⚠ {days}d</span>;
  // #13 — indicator for ≤ 14 days
  if (days <= 14) return <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">{days}d</span>;
  return <span className="text-xs text-gray-400">{days}d</span>;
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [form, setForm] = useState({ clientId: '', name: '', startDate: '', endDate: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null); // #9
  const [search, setSearch] = useState('');  // #6
  const [page, setPage] = useState(1);       // #8

  const load = () =>
    Promise.all([api.getCampaigns(), api.getClients()])
      .then(([c, cl]) => { setCampaigns(c); setClients(cl); })
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const toDateInput = (iso: string) => iso?.slice(0, 10) ?? '';

  const filtered = campaigns.filter((c) => {
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || (c.client?.name ?? '').toLowerCase().includes(q);
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openCreate = () => {
    setEditing(null);
    setForm({ clientId: '', name: '', startDate: '', endDate: '' });
    setError('');
    setShowModal(true);
  };

  const openEdit = (c: Campaign) => {
    setEditing(c);
    setForm({ clientId: c.clientId.toString(), name: c.name, startDate: toDateInput(c.startDate), endDate: toDateInput(c.endDate) });
    setError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const data = {
        clientId: Number(form.clientId),
        name: form.name,
        startDate: new Date(form.startDate).toISOString(),
        endDate: new Date(form.endDate).toISOString(),
      };
      editing ? await api.updateCampaign(editing.id, data) : await api.createCampaign(data);
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
    await api.deleteCampaign(deleteTarget.id).catch(() => {});
    setDeleteTarget(null);
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Campañas</h1>
        <button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          + Nueva campaña
        </button>
      </div>

      {/* #6 — search */}
      <div className="mb-4">
        <input
          className="input max-w-xs"
          placeholder="Buscar campaña o cliente..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {loading ? (
        <p className="text-gray-500">Cargando...</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-500">{search ? 'Sin resultados.' : 'No hay campañas.'}</p>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 font-medium text-gray-600">Nombre</th>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Cliente</th>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Inicio</th>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Fin</th>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Días restantes</th>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Estado</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {paged.map((c) => (
                <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium">{c.name}</td>
                  <td className="px-5 py-3 text-gray-500">{c.client?.name ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-500">{toDateInput(c.startDate)}</td>
                  <td className="px-5 py-3 text-gray-500">{toDateInput(c.endDate)}</td>
                  {/* #13 + #32 */}
                  <td className="px-5 py-3">
                    <DaysLeftBadge endDate={c.endDate} active={c.active} />
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {c.active ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  <td className="px-5 py-3 flex gap-3 justify-end">
                    <button onClick={() => openEdit(c)} className="text-blue-600 hover:underline text-xs">Editar</button>
                    <button onClick={() => setDeleteTarget(c)} className="text-red-500 hover:underline text-xs">Desactivar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* #8 — pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
          <span>{filtered.length} campañas · página {page} de {totalPages}</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">‹ Anterior</button>
            <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Siguiente ›</button>
          </div>
        </div>
      )}

      {/* #9 — confirm dialog */}
      {deleteTarget && (
        <ConfirmDialog
          title="Desactivar campaña"
          message={`¿Desactivar "${deleteTarget.name}"? Los anuncios asociados dejarán de estar disponibles.`}
          confirmLabel="Desactivar"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {showModal && (
        <Modal title={editing ? 'Editar campaña' : 'Nueva campaña'} onClose={() => setShowModal(false)}>
          <div className="space-y-4">
            <Field label="Cliente">
              <select className="input" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
                <option value="">Seleccionar cliente</option>
                {clients.filter(c => c.active).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Nombre"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Fecha inicio"><input type="date" className="input" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
            <Field label="Fecha fin"><input type="date" className="input" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-2 pt-2">
              <button onClick={handleSave} disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-2 rounded-lg text-sm font-medium">
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
              <button onClick={() => setShowModal(false)} className="flex-1 border border-gray-200 hover:bg-gray-50 py-2 rounded-lg text-sm">
                Cancelar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
