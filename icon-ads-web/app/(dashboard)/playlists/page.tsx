'use client';

import { useEffect, useState } from 'react';
import { api, Playlist, Ad } from '@/lib/api';

export default function PlaylistsPage() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedAds, setSelectedAds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () =>
    Promise.all([api.getPlaylists(), api.getAds()])
      .then(([p, a]) => { setPlaylists(p); setAds(a.filter(ad => ad.active)); })
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    await api.createPlaylist({ name: newName }).catch(() => {});
    setNewName('');
    setShowCreate(false);
    setCreating(false);
    load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('¿Eliminar esta playlist?')) return;
    await api.deletePlaylist(id).catch(() => {});
    load();
  };

  const openEditAds = (playlist: Playlist) => {
    setEditingId(playlist.id);
    setSelectedAds(playlist.playlistAds?.map((pa) => pa.adId) ?? []);
    setError('');
  };

  const toggleAd = (adId: number) => {
    setSelectedAds((prev) =>
      prev.includes(adId) ? prev.filter((id) => id !== adId) : [...prev, adId]
    );
  };

  const handleSaveAds = async () => {
    if (editingId === null) return;
    setSaving(true);
    setError('');
    try {
      await api.setPlaylistAds(
        editingId,
        selectedAds.map((adId, idx) => ({ adId, order: idx }))
      );
      setEditingId(null);
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
        <h1 className="text-2xl font-bold">Playlists</h1>
        <button onClick={() => setShowCreate(true)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          + Nueva playlist
        </button>
      </div>

      {showCreate && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-4 flex gap-3 items-center">
          <input
            className="input flex-1"
            placeholder="Nombre de la playlist"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            autoFocus
          />
          <button onClick={handleCreate} disabled={creating} className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg text-sm font-medium">
            {creating ? 'Creando...' : 'Crear'}
          </button>
          <button onClick={() => setShowCreate(false)} className="border border-gray-200 hover:bg-gray-50 px-4 py-2 rounded-lg text-sm">
            Cancelar
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Cargando...</p>
      ) : playlists.length === 0 ? (
        <p className="text-gray-500">No hay playlists.</p>
      ) : (
        <div className="space-y-4">
          {playlists.map((p) => (
            <div key={p.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="font-semibold">{p.name}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    v{p.version} · {p.playlistAds?.length ?? 0} anuncios · {p._count?.tablets ?? 0} tablets
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openEditAds(p)} className="text-blue-600 border border-blue-200 hover:bg-blue-50 px-3 py-1.5 rounded-lg text-xs font-medium">
                    Editar anuncios
                  </button>
                  <button onClick={() => handleDelete(p.id)} className="text-red-500 border border-red-100 hover:bg-red-50 px-3 py-1.5 rounded-lg text-xs font-medium">
                    Eliminar
                  </button>
                </div>
              </div>
              {p.playlistAds && p.playlistAds.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {p.playlistAds.map((pa) => (
                    <span key={pa.id} className="bg-gray-100 text-gray-700 text-xs px-2 py-1 rounded-full">
                      {pa.order + 1}. {pa.ad.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">Sin anuncios asignados.</p>
              )}
            </div>
          ))}
        </div>
      )}

      {editingId !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">Asignar anuncios</h2>
              <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Seleccioná los anuncios (el orden de selección define el orden de reproducción).
            </p>
            <div className="max-h-72 overflow-y-auto space-y-2 mb-4">
              {ads.length === 0 ? (
                <p className="text-gray-400 text-sm">No hay anuncios disponibles.</p>
              ) : (
                ads.map((ad) => {
                  const checked = selectedAds.includes(ad.id);
                  const pos = selectedAds.indexOf(ad.id);
                  return (
                    <label key={ad.id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" checked={checked} onChange={() => toggleAd(ad.id)} className="rounded" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{ad.name}</p>
                        <p className="text-xs text-gray-400">{ad.campaign?.name} · {ad.durationS}s · {ad.type}</p>
                      </div>
                      {checked && (
                        <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold shrink-0">
                          {pos + 1}
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
            {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
            <div className="flex gap-2">
              <button onClick={handleSaveAds} disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-2 rounded-lg text-sm font-medium">
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
              <button onClick={() => setEditingId(null)} className="flex-1 border border-gray-200 hover:bg-gray-50 py-2 rounded-lg text-sm">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
