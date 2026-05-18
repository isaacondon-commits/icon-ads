'use client';

import { useEffect, useRef, useState } from 'react';
import { api, Playlist, Ad } from '@/lib/api';
import ConfirmDialog from '@/components/ConfirmDialog';

const PAGE_SIZE = 10;

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
  const [deleteTarget, setDeleteTarget] = useState<Playlist | null>(null); // #9
  const [duplicating, setDuplicating] = useState<number | null>(null);     // #14
  const [search, setSearch] = useState('');  // #6
  const [page, setPage] = useState(1);       // #8

  // #2 — drag & drop state
  const dragIdx = useRef<number | null>(null);

  const load = () =>
    Promise.all([api.getPlaylists(), api.getAds()])
      .then(([p, a]) => { setPlaylists(p); setAds(a.filter(ad => ad.active)); })
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const filtered = playlists.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    await api.createPlaylist({ name: newName }).catch(() => {});
    setNewName('');
    setShowCreate(false);
    setCreating(false);
    load();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await api.deletePlaylist(deleteTarget.id).catch(() => {});
    setDeleteTarget(null);
    load();
  };

  // #14 — duplicate playlist
  const handleDuplicate = async (id: number) => {
    setDuplicating(id);
    try {
      await api.duplicatePlaylist(id);
      load();
    } finally {
      setDuplicating(null);
    }
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

  // #2 — drag handlers for reordering selected ads
  const handleDragStart = (idx: number) => { dragIdx.current = idx; };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;
    const updated = [...selectedAds];
    const [item] = updated.splice(dragIdx.current, 1);
    updated.splice(idx, 0, item);
    dragIdx.current = idx;
    setSelectedAds(updated);
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

      {/* #6 — search */}
      <div className="mb-4">
        <input
          className="input max-w-xs"
          placeholder="Buscar playlist..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
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
          <button onClick={() => setShowCreate(false)} className="border border-gray-200 hover:bg-gray-50 px-4 py-2 rounded-lg text-sm">Cancelar</button>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Cargando...</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-500">{search ? 'Sin resultados.' : 'No hay playlists.'}</p>
      ) : (
        <div className="space-y-4">
          {paged.map((p) => {
            const adCount = p.playlistAds?.length ?? 0;
            return (
              <div key={p.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div>
                      <h2 className="font-semibold">{p.name}</h2>
                      <p className="text-xs text-gray-400 mt-0.5">
                        v{p.version} · {p._count?.tablets ?? 0} tablets
                      </p>
                    </div>
                    {/* #12 — badge with ad count */}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${adCount > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                      {adCount} {adCount === 1 ? 'anuncio' : 'anuncios'}
                    </span>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-end">
                    <button onClick={() => openEditAds(p)} className="text-blue-600 border border-blue-200 hover:bg-blue-50 px-3 py-1.5 rounded-lg text-xs font-medium">
                      Editar anuncios
                    </button>
                    {/* #14 — duplicate button */}
                    <button
                      onClick={() => handleDuplicate(p.id)}
                      disabled={duplicating === p.id}
                      className="text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
                    >
                      {duplicating === p.id ? 'Duplicando...' : 'Duplicar'}
                    </button>
                    <button onClick={() => setDeleteTarget(p)} className="text-red-500 border border-red-100 hover:bg-red-50 px-3 py-1.5 rounded-lg text-xs font-medium">
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
            );
          })}
        </div>
      )}

      {/* #8 — pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
          <span>{filtered.length} playlists · página {page} de {totalPages}</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">‹ Anterior</button>
            <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Siguiente ›</button>
          </div>
        </div>
      )}

      {/* #9 — confirm delete */}
      {deleteTarget && (
        <ConfirmDialog
          title="Eliminar playlist"
          message={`¿Eliminar "${deleteTarget.name}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Edit ads modal — #2 drag & drop */}
      {editingId !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-lg">Asignar anuncios</h2>
              <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Seleccioná los anuncios y arrastrá para reordenar.
            </p>

            {/* Ordered selected list — draggable */}
            {selectedAds.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Orden de reproducción</p>
                <div className="space-y-1">
                  {selectedAds.map((adId, idx) => {
                    const ad = ads.find(a => a.id === adId);
                    if (!ad) return null;
                    return (
                      <div
                        key={adId}
                        draggable
                        onDragStart={() => handleDragStart(idx)}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        className="flex items-center gap-2 p-2 rounded-lg bg-blue-50 border border-blue-100 cursor-grab active:cursor-grabbing select-none"
                      >
                        <span className="text-gray-400 text-sm">⠿</span>
                        <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold shrink-0">{idx + 1}</span>
                        <span className="text-sm font-medium truncate">{ad.name}</span>
                        <span className="text-xs text-gray-400 ml-auto">{ad.durationS}s</span>
                        <button
                          onClick={() => toggleAd(adId)}
                          className="text-gray-400 hover:text-red-500 text-xs ml-1"
                        >✕</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* All available ads to add */}
            <div className="max-h-52 overflow-y-auto space-y-1 mb-4 border-t border-gray-100 pt-3">
              <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Anuncios disponibles</p>
              {ads.length === 0 ? (
                <p className="text-gray-400 text-sm">No hay anuncios disponibles.</p>
              ) : (
                ads.filter(ad => !selectedAds.includes(ad.id)).map((ad) => (
                  <button
                    key={ad.id}
                    onClick={() => toggleAd(ad.id)}
                    className="w-full flex items-center gap-3 p-2 rounded-lg border border-gray-100 hover:bg-gray-50 text-left"
                  >
                    <span className="w-4 h-4 rounded border-2 border-gray-300 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{ad.name}</p>
                      <p className="text-xs text-gray-400">{ad.campaign?.name} · {ad.durationS}s</p>
                    </div>
                    <span className="text-xs text-blue-600">+ Agregar</span>
                  </button>
                ))
              )}
            </div>

            {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
            <div className="flex gap-2">
              <button onClick={handleSaveAds} disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-2 rounded-lg text-sm font-medium">
                {saving ? 'Guardando...' : `Guardar (${selectedAds.length} anuncios)`}
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
