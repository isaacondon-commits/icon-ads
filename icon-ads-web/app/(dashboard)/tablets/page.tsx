'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, Tablet, Playlist, BASE } from '@/lib/api';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useToast } from '@/lib/toast-context';

const PAGE_SIZE = 10;
type StatusFilter = 'all' | 'online' | 'offline' | 'no-playlist';
const TIMEZONES = ['America/Montevideo', 'America/Argentina/Buenos_Aires', 'America/Sao_Paulo', 'UTC'];
const LS_SEARCH = 'tablets_filter_search';
const LS_STATUS = 'tablets_filter_status';

export default function TabletsPage() {
  const { show } = useToast();
  const [tablets, setTablets] = useState<Tablet[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Tablet | null>(null);
  const [form, setForm] = useState({ deviceId: '', name: '', zone: '', playlistId: '', timezone: 'America/Montevideo', scheduleAt: '', notes: '', maintenanceUntil: '', driverName: '', licensePlate: '', spotPrice: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Tablet | null>(null);
  const [search, setSearch] = useState(() => typeof window !== 'undefined' ? (localStorage.getItem(LS_SEARCH) ?? '') : '');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    if (typeof window === 'undefined') return 'all';
    return (localStorage.getItem(LS_STATUS) as StatusFilter) ?? 'all';
  });
  const [page, setPage] = useState(1);
  const [forcingSync, setForcingSync] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const load = () =>
    Promise.all([api.getTablets(), api.getPlaylists()])
      .then(([t, p]) => { setTablets(t); setPlaylists(p); })
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  // Keyboard shortcuts (#12)
  useEffect(() => {
    const onNew = () => openCreate();
    const onClose = () => setShowModal(false);
    document.addEventListener('iconads:new', onNew);
    document.addEventListener('iconads:close-modal', onClose);
    return () => { document.removeEventListener('iconads:new', onNew); document.removeEventListener('iconads:close-modal', onClose); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const now = Date.now();
  const filtered = tablets.filter((t) => {
    const q = search.toLowerCase();
    const matchSearch = t.name.toLowerCase().includes(q) || t.deviceId.toLowerCase().includes(q) || (t.zone ?? '').toLowerCase().includes(q);
    const lastMs = t.lastSync ? new Date(t.lastSync).getTime() : 0;
    const isOnline = lastMs && (now - lastMs) < 10 * 60000;
    const matchStatus =
      statusFilter === 'all' || (statusFilter === 'online' && isOnline) ||
      (statusFilter === 'offline' && !isOnline) || (statusFilter === 'no-playlist' && !t.playlistId);
    return matchSearch && matchStatus;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openCreate = () => {
    setEditing(null);
    setForm({ deviceId: '', name: '', zone: '', playlistId: '', timezone: 'America/Montevideo', scheduleAt: '', notes: '', maintenanceUntil: '', driverName: '', licensePlate: '', spotPrice: '' });
    setError(''); setShowModal(true);
  };

  const openEdit = (t: Tablet) => {
    setEditing(t);
    setForm({
      deviceId: t.deviceId, name: t.name, zone: t.zone ?? '',
      playlistId: t.playlistId?.toString() ?? '',
      timezone: t.timezone ?? 'America/Montevideo',
      scheduleAt: t.scheduleAt ? t.scheduleAt.slice(0, 16) : '',
      notes: t.notes ?? '',
      maintenanceUntil: t.maintenanceUntil ? t.maintenanceUntil.slice(0, 16) : '',
      driverName: t.driverName ?? '',
      licensePlate: t.licensePlate ?? '',
      spotPrice: t.spotPrice != null ? String(t.spotPrice) : '',
    });
    setError(''); setShowModal(true);
  };

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      const data = {
        deviceId: form.deviceId, name: form.name, zone: form.zone || undefined,
        timezone: form.timezone || undefined,
        playlistId: form.playlistId ? Number(form.playlistId) : null,
        scheduleAt: form.scheduleAt ? new Date(form.scheduleAt).toISOString() : null,
        notes: form.notes || null,
        maintenanceUntil: form.maintenanceUntil ? new Date(form.maintenanceUntil).toISOString() : null,
        driverName: form.driverName || null,
        licensePlate: form.licensePlate || null,
        spotPrice: form.spotPrice ? Number(form.spotPrice) : null,
      };
      editing ? await api.updateTablet(editing.id, data) : await api.createTablet(data);
      setShowModal(false); load();
      show(editing ? 'Tablet actualizada' : 'Tablet creada');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteTablet(deleteTarget.id);
      show('Tablet eliminada', 'info');
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error al eliminar', 'error');
    } finally { setDeleteTarget(null); }
  };

  const handleForceSync = async (id: number) => {
    setForcingSync(id);
    try {
      const res = await api.forceSync(id);
      show(res.message);
    } catch {
      show('Error al forzar sync', 'error');
    } finally { setForcingSync(null); }
  };

  const copyDeviceId = async (t: Tablet) => {
    await navigator.clipboard.writeText(t.deviceId);
    setCopiedId(t.id);
    show(`Device ID copiado: ${t.deviceId}`, 'info');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const exportCSV = () => {
    window.open(`${BASE}/api/admin/export/tablets`, '_blank');
  };

  const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'Todas' }, { key: 'online', label: 'Online' },
    { key: 'offline', label: 'Offline' }, { key: 'no-playlist', label: 'Sin playlist' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Tablets</h1>
        <div className="flex gap-2">
          <button onClick={exportCSV} className="border px-3 py-2 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800" style={{ borderColor: 'var(--border-md)', color: 'var(--text-muted)' }}
            title="Exportar a CSV">
            ↓ CSV
          </button>
          <button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium" title="Nueva tablet (N)">
            + Nueva tablet
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input className="input w-56" placeholder="Buscar tablet..." value={search} onChange={(e) => { setSearch(e.target.value); localStorage.setItem(LS_SEARCH, e.target.value); setPage(1); }} />
        <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-md)' }}>
          {STATUS_FILTERS.map(({ key, label }) => (
            <button key={key} onClick={() => { setStatusFilter(key); localStorage.setItem(LS_STATUS, key); setPage(1); }}
              className={`px-3 py-2 text-xs font-medium border-r last:border-0 ${statusFilter === key ? 'bg-blue-600 text-white' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
              style={{ borderColor: 'var(--border-md)', color: statusFilter === key ? 'white' : 'var(--text-muted)' }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="skeleton h-12 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>{search || statusFilter !== 'all' ? 'Sin resultados.' : 'No hay tablets registradas.'}</p>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ background: 'var(--bg)', borderColor: 'var(--border-md)' }}>
                {['Nombre', 'Device ID', 'Zona', 'Estado', 'Batería', 'APK', 'Playlist', 'Última sincronía', ''].map((h) => (
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
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <Link href={`/tablets/${t.id}`} className="hover:underline text-blue-600">{t.name}</Link>
                          {/* #10 — Badge "Nueva" si fue registrada en las últimas 24h */}
                          {Date.now() - new Date(t.createdAt).getTime() < 86400000 && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-medium leading-none">
                              Nueva
                            </span>
                          )}
                        </div>
                        {/* #6 — Días activo */}
                        <span className="text-xs mt-0.5" style={{ color: 'var(--text-xs)' }}>
                          {Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 86400000)} días activo
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{t.deviceId}</span>
                        <button onClick={() => copyDeviceId(t)} title="Copiar Device ID"
                          className="text-xs opacity-50 hover:opacity-100 transition-opacity">
                          {copiedId === t.id ? '✓' : '⎘'}
                        </button>
                      </div>
                    </td>
                    <td className="px-5 py-3" style={{ color: 'var(--text-muted)' }}>{t.zone ?? '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isOnline ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>
                        {isOnline ? 'online' : 'offline'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {t.batteryLevel != null ? (
                        <span className={`font-medium ${t.batteryLevel <= 20 ? 'text-red-500' : t.batteryLevel <= 50 ? 'text-amber-500' : 'text-emerald-600'}`}>
                          {t.batteryLevel}%
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-5 py-3 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{t.appVersion ?? '—'}</td>
                    <td className="px-5 py-3" style={{ color: 'var(--text-muted)' }}>{t.playlist?.name ?? '—'}</td>
                    <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-xs)' }}>
                      {t.lastSync ? new Date(t.lastSync).toLocaleString('es-AR') : 'Nunca'}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex gap-2 justify-end items-center">
                        <button onClick={() => handleForceSync(t.id)} disabled={forcingSync === t.id}
                          className="text-violet-600 hover:underline text-xs disabled:opacity-40" title="Forzar sincronización">
                          {forcingSync === t.id ? '...' : 'Sync'}
                        </button>
                        <button onClick={() => openEdit(t)} className="text-blue-600 hover:underline text-xs" title="Editar">Editar</button>
                        <button onClick={() => setDeleteTarget(t)} className="text-red-500 hover:underline text-xs" title="Eliminar">✕</button>
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
        <ConfirmDialog title="Eliminar tablet" message={`¿Eliminar "${deleteTarget.name}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="rounded-xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" style={{ background: 'var(--card)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">{editing ? 'Editar tablet' : 'Nueva tablet'}</h2>
              <button onClick={() => setShowModal(false)} className="text-xl leading-none" style={{ color: 'var(--text-muted)' }} title="Cerrar (ESC)">×</button>
            </div>
            <div className="space-y-4">
              <Field label="Device ID"><input className="input" value={form.deviceId} disabled={!!editing} onChange={(e) => setForm({ ...form, deviceId: e.target.value })} placeholder="tablet-001" /></Field>
              <Field label="Nombre"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Zona (opcional)"><input className="input" value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })} placeholder="Planta baja" /></Field>
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
              <Field label="Programar activación (opcional)">
                <input type="datetime-local" className="input" value={form.scheduleAt} onChange={(e) => setForm({ ...form, scheduleAt: e.target.value })} />
              </Field>
              <Field label="Mantenimiento hasta (opcional)">
                <input type="datetime-local" className="input" value={form.maintenanceUntil} onChange={(e) => setForm({ ...form, maintenanceUntil: e.target.value })} />
              </Field>
              <Field label="Notas (opcional)">
                <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Observaciones internas..." style={{ resize: 'vertical' }} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Conductor (opcional)">
                  <input className="input" value={form.driverName} onChange={(e) => setForm({ ...form, driverName: e.target.value })} placeholder="Nombre del conductor" />
                </Field>
                <Field label="Patente (opcional)">
                  <input className="input" value={form.licensePlate} onChange={(e) => setForm({ ...form, licensePlate: e.target.value })} placeholder="ABC 1234" />
                </Field>
              </div>
              <Field label="Precio por spot (USD, opcional)">
                <input type="number" min="0" step="0.01" className="input" value={form.spotPrice} onChange={(e) => setForm({ ...form, spotPrice: e.target.value })} placeholder="0.00" />
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
