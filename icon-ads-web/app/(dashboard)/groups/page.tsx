'use client';

import { useEffect, useState } from 'react';
import { api, TabletGroup, Tablet, Playlist } from '@/lib/api';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useToast } from '@/lib/toast-context';

export default function GroupsPage() {
  const { show } = useToast();
  const [groups, setGroups] = useState<TabletGroup[]>([]);
  const [tablets, setTablets] = useState<Tablet[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<TabletGroup | null>(null);
  const [form, setForm] = useState({ name: '', playlistId: '' });
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TabletGroup | null>(null);

  const load = () =>
    Promise.allSettled([api.getTabletGroups(), api.getTablets(), api.getPlaylists()])
      .then(([g, t, p]) => {
        if (g.status === 'fulfilled') setGroups(g.value);
        if (t.status === 'fulfilled') setTablets(t.value);
        if (p.status === 'fulfilled') setPlaylists(p.value);
      })
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm({ name: '', playlistId: '' }); setShowModal(true); };
  const openEdit = (g: TabletGroup) => { setEditing(g); setForm({ name: g.name, playlistId: g.playlistId?.toString() ?? '' }); setShowModal(true); };

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = { name: form.name, playlistId: form.playlistId ? Number(form.playlistId) : null };
      if (editing) await api.updateTabletGroup(editing.id, data);
      else await api.createTabletGroup(data);
      setShowModal(false);
      show(editing ? 'Grupo actualizado' : 'Grupo creado');
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error', 'error');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteTabletGroup(deleteTarget.id);
      show('Grupo eliminado', 'info');
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error', 'error');
    } finally { setDeleteTarget(null); }
  };

  const handleAssignGroup = async (tablet: Tablet, groupId: string) => {
    try {
      await api.assignTabletGroup(tablet.id, groupId ? Number(groupId) : null);
      show(`${tablet.name} asignada al grupo`);
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error', 'error');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Grupos de tablets</h1>
        <button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          + Nuevo grupo
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Cargando...</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {groups.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No hay grupos creados. Crea uno para asignar playlists a múltiples tablets a la vez.</p>
          ) : groups.map((g) => (
            <div key={g.id} className="card p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h2 className="font-semibold">{g.name}</h2>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {g._count?.tablets ?? 0} tablet{(g._count?.tablets ?? 0) !== 1 ? 's' : ''} ·{' '}
                    {g.playlist?.name ? `Playlist: ${g.playlist.name}` : 'Sin playlist asignada'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openEdit(g)} className="text-xs text-blue-600 hover:underline">Editar</button>
                  <button onClick={() => setDeleteTarget(g)} className="text-xs text-red-500 hover:underline">Eliminar</button>
                </div>
              </div>
              <div className="space-y-1">
                {tablets.filter((t) => t.groupId === g.id).map((t) => (
                  <div key={t.id} className="flex items-center justify-between text-xs py-1 border-b" style={{ borderColor: 'var(--border)' }}>
                    <span>{t.name}</span>
                    <button onClick={() => handleAssignGroup(t, '')} className="text-red-500 hover:underline">Quitar</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Unassigned tablets */}
      {tablets.filter((t) => !t.groupId).length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b font-semibold text-sm" style={{ borderColor: 'var(--border-md)' }}>
            Tablets sin grupo ({tablets.filter((t) => !t.groupId).length})
          </div>
          <table className="w-full text-sm">
            <tbody>
              {tablets.filter((t) => !t.groupId).map((t) => (
                <tr key={t.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-5 py-3">{t.name}</td>
                  <td className="px-5 py-3" style={{ color: 'var(--text-muted)' }}>{t.zone ?? '—'}</td>
                  <td className="px-5 py-3 text-right">
                    <select
                      className="input text-xs py-1"
                      value=""
                      onChange={(e) => { if (e.target.value) handleAssignGroup(t, e.target.value); }}
                    >
                      <option value="">Asignar a grupo...</option>
                      {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Eliminar grupo"
          message={`¿Eliminar el grupo "${deleteTarget.name}"? Las tablets del grupo no se eliminan.`}
          confirmLabel="Eliminar"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="rounded-xl shadow-xl w-full max-w-sm p-6" style={{ background: 'var(--card)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">{editing ? 'Editar grupo' : 'Nuevo grupo'}</h2>
              <button onClick={() => setShowModal(false)} className="text-xl" style={{ color: 'var(--text-muted)' }}>×</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Nombre</label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Playlist del grupo (opcional)</label>
                <select className="input" value={form.playlistId} onChange={(e) => setForm({ ...form, playlistId: e.target.value })}>
                  <option value="">Sin playlist</option>
                  {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {form.playlistId && editing && (
                  <p className="text-xs mt-1 text-amber-600">Guardar aplicará esta playlist a todas las tablets del grupo.</p>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={handleSave} disabled={saving || !form.name} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-2 rounded-lg text-sm font-medium">
                  {saving ? 'Guardando...' : 'Guardar'}
                </button>
                <button onClick={() => setShowModal(false)} className="flex-1 border py-2 rounded-lg text-sm" style={{ borderColor: 'var(--border-md)' }}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
