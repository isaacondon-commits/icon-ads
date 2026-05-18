'use client';

import { useEffect, useState } from 'react';
import { api, Tablet, Playlist } from '@/lib/api';
import ConfirmDialog from '@/components/ConfirmDialog';

const PAGE_SIZE = 10;
type StatusFilter = 'all' | 'online' | 'offline' | 'no-playlist';

export default function TabletsPage() {
  const [tablets, setTablets] = useState<Tablet[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Tablet | null>(null);
  const [form, setForm] = useState({ deviceId: '', name: '', zone: '', playlistId: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Tablet | null>(null); // #9
  const [search, setSearch] = useState('');              // #6
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all'); // #7
  const [page, setPage] = useState(1);                   // #8
  const [forcingSync, setForcingSync] = useState<number | null>(null);   // #48
  const [syncMsg, setSyncMsg] = useState('');

  const load = () =>
    Promise.all([api.getTablets(), api.getPlaylists()])
      .then(([t, p]) => { setTablets(t); setPlaylists(p); })
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  // #6 + #7 — combined search + status filter
  const filtered = tablets.filter((t) => {
    const q = search.toLowerCase();
    const matchSearch =
      t.name.toLowerCase().includes(q) ||
      t.deviceId.toLowerCase().includes(q) ||
      (t.zone ?? '').toLowerCase().includes(q);

    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'online' && t.status === 'online') ||
      (statusFilter === 'offline' && t.status === 'offline') ||
      (statusFilter === 'no-playlist' && !t.playlistId);

    return matchSearch && matchStatus;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openCreate = () => {
    setEditing(null);
    setForm({ deviceId: '', name: '', zone: '', playlistId: '' });
    setError('');
    setShowModal(true);
  };

  const openEdit = (t: Tablet) => {
    setEditing(t);
    setForm({ deviceId: t.deviceId, name: t.name, zone: t.zone ?? '', playlistId: t.playlistId?.toString() ?? '' });
    setError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const data = {
        deviceId: form.deviceId,
        name: form.name,
        zone: form.zone || undefined,
        playlistId: form.playlistId ? Number(form.playlistId) : null,
      };
      editing ? await api.updateTablet(editing.id, data) : await api.createTablet(data);
      setShowModal(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  // #48 — force sync
  const handleForceSync = async (id: number) => {
    setForcingSync(id);
    setSyncMsg('');
    try {
      const res = await api.forceSync(id);
      setSyncMsg(res.message);
      setTimeout(() => setSyncMsg(''), 4000);
    } finally {
      setForcingSync(null);
    }
  };

  const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'Todas' },
    { key: 'online', label: 'Online' },
    { key: 'offline', label: 'Offline' },
    { key: 'no-playlist', label: 'Sin playlist' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Tablets</h1>
        <button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          + Nueva tablet
        </button>
      </div>

      {/* #6 search + #7 status filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input
          className="input w-56"
          placeholder="Buscar tablet..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          {STATUS_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setStatusFilter(key); setPage(1); }}
              className={`px-3 py-2 text-xs font-medium border-r last:border-0 border-gray-200 ${statusFilter === key ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {syncMsg && <p className="text-emerald-600 text-sm">{syncMsg}</p>}
      </div>

      {loading ? (
        <p className="text-gray-500">Cargando...</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-500">{search || statusFilter !== 'all' ? 'Sin resultados.' : 'No hay tablets registradas.'}</p>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 font-medium text-gray-600">Nombre</th>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Device ID</th>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Zona</th>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Estado</th>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Playlist</th>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Última sincronía</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {paged.map((t) => (
                <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium">{t.name}</td>
                  <td className="px-5 py-3 text-gray-500 font-mono text-xs">{t.deviceId}</td>
                  <td className="px-5 py-3 text-gray-500">{t.zone ?? '—'}</td>
                  <td className="px-5 py-3"><StatusBadge status={t.status} /></td>
                  <td className="px-5 py-3 text-gray-500">{t.playlist?.name ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-400 text-xs">
                    {t.lastSync ? new Date(t.lastSync).toLocaleString('es-AR') : 'Nunca'}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex gap-2 justify-end items-center">
                      {/* #48 — force sync button */}
                      <button
                        onClick={() => handleForceSync(t.id)}
                        disabled={forcingSync === t.id}
                        className="text-violet-600 hover:underline text-xs disabled:opacity-40"
                        title="Forzar sincronización en la próxima conexión"
                      >
                        {forcingSync === t.id ? 'Enviando...' : 'Sync'}
                      </button>
                      <button onClick={() => openEdit(t)} className="text-blue-600 hover:underline text-xs">Editar</button>
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
        <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
          <span>{filtered.length} tablets · página {page} de {totalPages}</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">‹ Anterior</button>
            <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Siguiente ›</button>
          </div>
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Eliminar tablet"
          message={`¿Eliminar "${deleteTarget.name}"?`}
          confirmLabel="Eliminar"
          onConfirm={async () => { setDeleteTarget(null); }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {showModal && (
        <Modal title={editing ? 'Editar tablet' : 'Nueva tablet'} onClose={() => setShowModal(false)}>
          <div className="space-y-4">
            <Field label="Device ID">
              <input className="input" value={form.deviceId} disabled={!!editing} onChange={(e) => setForm({ ...form, deviceId: e.target.value })} placeholder="tablet-001" />
            </Field>
            <Field label="Nombre">
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Tablet recepción" />
            </Field>
            <Field label="Zona (opcional)">
              <input className="input" value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })} placeholder="Planta baja" />
            </Field>
            <Field label="Playlist (opcional)">
              <select className="input" value={form.playlistId} onChange={(e) => setForm({ ...form, playlistId: e.target.value })}>
                <option value="">Sin playlist</option>
                {playlists.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
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

function StatusBadge({ status }: { status: Tablet['status'] }) {
  const map = { online: 'bg-emerald-100 text-emerald-700', offline: 'bg-gray-100 text-gray-600', syncing: 'bg-blue-100 text-blue-700' };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[status]}`}>{status}</span>;
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
