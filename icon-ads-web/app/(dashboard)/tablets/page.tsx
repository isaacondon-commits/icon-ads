'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, Tablet, Playlist } from '@/lib/api';
import ConfirmDialog from '@/components/ConfirmDialog';

const PAGE_SIZE = 10;
type StatusFilter = 'all' | 'online' | 'offline' | 'no-playlist';

const TIMEZONES = ['America/Montevideo', 'America/Argentina/Buenos_Aires', 'America/Sao_Paulo', 'UTC'];

export default function TabletsPage() {
  const [tablets, setTablets] = useState<Tablet[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Tablet | null>(null);
  const [form, setForm] = useState({ deviceId: '', name: '', zone: '', playlistId: '', timezone: 'America/Montevideo', scheduleAt: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Tablet | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [forcingSync, setForcingSync] = useState<number | null>(null);
  const [syncMsg, setSyncMsg] = useState('');

  const load = () =>
    Promise.all([api.getTablets(), api.getPlaylists()])
      .then(([t, p]) => { setTablets(t); setPlaylists(p); })
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const now = Date.now();
  const filtered = tablets.filter((t) => {
    const q = search.toLowerCase();
    const matchSearch = t.name.toLowerCase().includes(q) || t.deviceId.toLowerCase().includes(q) || (t.zone ?? '').toLowerCase().includes(q);
    const lastMs = t.lastSync ? new Date(t.lastSync).getTime() : 0;
    const isOnline = lastMs && (now - lastMs) < 10 * 60000;
    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'online' && isOnline) ||
      (statusFilter === 'offline' && !isOnline) ||
      (statusFilter === 'no-playlist' && !t.playlistId);
    return matchSearch && matchStatus;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openCreate = () => {
    setEditing(null);
    setForm({ deviceId: '', name: '', zone: '', playlistId: '', timezone: 'America/Montevideo', scheduleAt: '' });
    setError(''); setShowModal(true);
  };

  const openEdit = (t: Tablet) => {
    setEditing(t);
    setForm({
      deviceId: t.deviceId, name: t.name, zone: t.zone ?? '',
      playlistId: t.playlistId?.toString() ?? '',
      timezone: t.timezone ?? 'America/Montevideo',
      scheduleAt: t.scheduleAt ? t.scheduleAt.slice(0, 16) : '',
    });
    setError(''); setShowModal(true);
  };

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      const data = {
        deviceId: form.deviceId,
        name: form.name,
        zone: form.zone || undefined,
        timezone: form.timezone || undefined,
        playlistId: form.playlistId ? Number(form.playlistId) : null,
        scheduleAt: form.scheduleAt ? new Date(form.scheduleAt).toISOString() : null,
      };
      editing ? await api.updateTablet(editing.id, data) : await api.createTablet(data);
      setShowModal(false); load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally { setSaving(false); }
  };

  const handleForceSync = async (id: number) => {
    setForcingSync(id); setSyncMsg('');
    try {
      const res = await api.forceSync(id);
      setSyncMsg(res.message);
      setTimeout(() => setSyncMsg(''), 4000);
    } finally { setForcingSync(null); }
  };

  const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'Todas' }, { key: 'online', label: 'Online' },
    { key: 'offline', label: 'Offline' }, { key: 'no-playlist', label: 'Sin playlist' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Tablets</h1>
        <button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          + Nueva tablet
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input className="input w-56" placeholder="Buscar tablet..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-md)' }}>
          {STATUS_FILTERS.map(({ key, label }) => (
            <button key={key} onClick={() => { setStatusFilter(key); setPage(1); }}
              className={`px-3 py-2 text-xs font-medium border-r last:border-0 ${statusFilter === key ? 'bg-blue-600 text-white' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
              style={{ borderColor: 'var(--border-md)', color: statusFilter === key ? 'white' : 'var(--text-muted)' }}>
              {label}
            </button>
          ))}
        </div>
        {syncMsg && <p className="text-emerald-600 text-sm">{syncMsg}</p>}
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Cargando...</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>{search || statusFilter !== 'all' ? 'Sin resultados.' : 'No hay tablets registradas.'}</p>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ background: 'var(--bg)', borderColor: 'var(--border-md)' }}>
                {['Nombre','Device ID','Zona','Estado','Playlist','Última sincronía','Editado',''].map((h) => (
                  <th key={h} className={`${h ? 'text-left' : ''} px-5 py-3 font-medium text-xs`} style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((t) => {
                const lastMs = t.lastSync ? new Date(t.lastSync).getTime() : 0;
                const isOnline = lastMs && (now - lastMs) < 10 * 60000;
                return (
                  <tr key={t.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-5 py-3 font-medium">
                      <Link href={`/tablets/${t.id}`} className="hover:underline text-blue-600">{t.name}</Link>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{t.deviceId}</td>
                    <td className="px-5 py-3" style={{ color: 'var(--text-muted)' }}>{t.zone ?? '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                        {isOnline ? 'online' : 'offline'}
                      </span>
                    </td>
                    <td className="px-5 py-3" style={{ color: 'var(--text-muted)' }}>{t.playlist?.name ?? '—'}</td>
                    <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-xs)' }}>
                      {t.lastSync ? new Date(t.lastSync).toLocaleString('es-AR') : 'Nunca'}
                    </td>
                    <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-xs)' }}>
                      {new Date(t.updatedAt).toLocaleDateString('es-AR')}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex gap-2 justify-end items-center">
                        <button onClick={() => handleForceSync(t.id)} disabled={forcingSync === t.id} className="text-violet-600 hover:underline text-xs disabled:opacity-40">
                          {forcingSync === t.id ? 'Enviando...' : 'Sync'}
                        </button>
                        <button onClick={() => openEdit(t)} className="text-blue-600 hover:underline text-xs">Editar</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>
          <span>{filtered.length} tablets · página {page} de {totalPages}</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 rounded border disabled:opacity-40" style={{ borderColor: 'var(--border-md)' }}>‹ Anterior</button>
            <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 rounded border disabled:opacity-40" style={{ borderColor: 'var(--border-md)' }}>Siguiente ›</button>
          </div>
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog title="Eliminar tablet" message={`¿Eliminar "${deleteTarget.name}"?`} confirmLabel="Eliminar" onConfirm={async () => setDeleteTarget(null)} onCancel={() => setDeleteTarget(null)} />
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="rounded-xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" style={{ background: 'var(--card)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">{editing ? 'Editar tablet' : 'Nueva tablet'}</h2>
              <button onClick={() => setShowModal(false)} className="text-xl leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
            </div>
            <div className="space-y-4">
              <Field label="Device ID"><input className="input" value={form.deviceId} disabled={!!editing} onChange={(e) => setForm({ ...form, deviceId: e.target.value })} placeholder="tablet-001" /></Field>
              <Field label="Nombre"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Zona (opcional)"><input className="input" value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })} placeholder="Planta baja" /></Field>
              {/* #24 — Timezone */}
              <Field label="Zona horaria">
                <select className="input" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </Field>
              <Field label="Playlist (opcional)">
                <select className="input" value={form.playlistId} onChange={(e) => setForm({ ...form, playlistId: e.target.value })}>
                  <option value="">Sin playlist</option>
                  {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              {/* #25 — Schedule at */}
              <Field label="Programar activación (opcional)">
                <input type="datetime-local" className="input" value={form.scheduleAt} onChange={(e) => setForm({ ...form, scheduleAt: e.target.value })} />
              </Field>
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <div className="flex gap-2 pt-2">
                <button onClick={handleSave} disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-2 rounded-lg text-sm font-medium">
                  {saving ? 'Guardando...' : 'Guardar'}
                </button>
                <button onClick={() => setShowModal(false)} className="flex-1 border hover:bg-gray-50 dark:hover:bg-gray-800 py-2 rounded-lg text-sm" style={{ borderColor: 'var(--border-md)' }}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{label}</label>
      {children}
    </div>
  );
}
