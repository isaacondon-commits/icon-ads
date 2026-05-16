'use client';

import { useEffect, useState } from 'react';
import { api, Tablet, Playlist } from '@/lib/api';

export default function TabletsPage() {
  const [tablets, setTablets] = useState<Tablet[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Tablet | null>(null);
  const [form, setForm] = useState({ deviceId: '', name: '', zone: '', playlistId: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () =>
    Promise.all([api.getTablets(), api.getPlaylists()])
      .then(([t, p]) => { setTablets(t); setPlaylists(p); })
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

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
      if (editing) {
        await api.updateTablet(editing.id, data);
      } else {
        await api.createTablet(data);
      }
      setShowModal(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Tablets</h1>
        <button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          + Nueva tablet
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500">Cargando...</p>
      ) : tablets.length === 0 ? (
        <p className="text-gray-500">No hay tablets registradas.</p>
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
              {tablets.map((t) => (
                <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium">{t.name}</td>
                  <td className="px-5 py-3 text-gray-500 font-mono text-xs">{t.deviceId}</td>
                  <td className="px-5 py-3 text-gray-500">{t.zone ?? '—'}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-5 py-3 text-gray-500">{t.playlist?.name ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-400 text-xs">
                    {t.lastSync ? new Date(t.lastSync).toLocaleString('es-AR') : 'Nunca'}
                  </td>
                  <td className="px-5 py-3">
                    <button onClick={() => openEdit(t)} className="text-blue-600 hover:underline text-xs">Editar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <Modal title={editing ? 'Editar tablet' : 'Nueva tablet'} onClose={() => setShowModal(false)}>
          <div className="space-y-4">
            <Field label="Device ID">
              <input
                className="input"
                value={form.deviceId}
                disabled={!!editing}
                onChange={(e) => setForm({ ...form, deviceId: e.target.value })}
                placeholder="tablet-001"
              />
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
  const map = {
    online: 'bg-emerald-100 text-emerald-700',
    offline: 'bg-gray-100 text-gray-600',
    syncing: 'bg-blue-100 text-blue-700',
  };
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
