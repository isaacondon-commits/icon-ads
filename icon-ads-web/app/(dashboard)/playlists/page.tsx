'use client';

import { useEffect, useRef, useState } from 'react';
import { api, Playlist, Ad, PlaylistVersion, BASE } from '@/lib/api';
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
  const [deleteError, setDeleteError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Playlist | null>(null);
  const [duplicating, setDuplicating] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [previewPlaylist, setPreviewPlaylist] = useState<Playlist | null>(null); // #11
  const [versionsPlaylist, setVersionsPlaylist] = useState<Playlist | null>(null); // #17
  const [versions, setVersions] = useState<PlaylistVersion[]>([]);
  const [reverting, setReverting] = useState<number | null>(null);
  const dragIdx = useRef<number | null>(null);

  const load = () =>
    Promise.all([api.getPlaylists(), api.getAds()])
      .then(([p, a]) => { setPlaylists(p); setAds(a.filter(ad => ad.active && ad.approvalStatus === 'approved')); })
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const filtered = playlists.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    await api.createPlaylist({ name: newName }).catch(() => {});
    setNewName(''); setShowCreate(false); setCreating(false);
    load();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.deletePlaylist(deleteTarget.id);
      setDeleteTarget(null);
      load();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Error al eliminar');
      setDeleteTarget(null);
    }
  };

  const handleDuplicate = async (id: number) => {
    setDuplicating(id);
    try { await api.duplicatePlaylist(id); load(); } finally { setDuplicating(null); }
  };

  const openEditAds = (playlist: Playlist) => {
    setEditingId(playlist.id);
    setSelectedAds(playlist.playlistAds?.map((pa) => pa.adId) ?? []);
    setError('');
  };

  const toggleAd = (adId: number) => {
    setSelectedAds((prev) => prev.includes(adId) ? prev.filter((id) => id !== adId) : [...prev, adId]);
  };

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
    setSaving(true); setError('');
    try {
      await api.setPlaylistAds(editingId, selectedAds.map((adId, idx) => ({ adId, order: idx })));
      setEditingId(null); load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally { setSaving(false); }
  };

  // #17 — load versions
  const openVersions = async (playlist: Playlist) => {
    setVersionsPlaylist(playlist);
    const v = await api.getPlaylistVersions(playlist.id).catch(() => []);
    setVersions(v);
  };

  const handleRevert = async (version: number) => {
    if (!versionsPlaylist) return;
    setReverting(version);
    try {
      await api.revertPlaylist(versionsPlaylist.id, version);
      setVersionsPlaylist(null);
      load();
    } finally { setReverting(null); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Playlists</h1>
        <button onClick={() => setShowCreate(true)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          + Nueva playlist
        </button>
      </div>

      {deleteError && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 flex items-center justify-between">
          <p className="text-sm text-red-600">{deleteError}</p>
          <button onClick={() => setDeleteError('')} className="text-red-400 hover:text-red-600 ml-3 text-lg leading-none">×</button>
        </div>
      )}

      <div className="mb-4">
        <input className="input max-w-xs" placeholder="Buscar playlist..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>

      {showCreate && (
        <div className="card p-4 mb-4 flex gap-3 items-center">
          <input className="input flex-1" placeholder="Nombre de la playlist" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreate()} autoFocus />
          <button onClick={handleCreate} disabled={creating} className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg text-sm font-medium">
            {creating ? 'Creando...' : 'Crear'}
          </button>
          <button onClick={() => setShowCreate(false)} className="border hover:bg-gray-50 dark:hover:bg-gray-800 px-4 py-2 rounded-lg text-sm" style={{ borderColor: 'var(--border-md)' }}>Cancelar</button>
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Cargando...</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>{search ? 'Sin resultados.' : 'No hay playlists.'}</p>
      ) : (
        <div className="space-y-4">
          {paged.map((p) => {
            const adCount = p.playlistAds?.length ?? 0;
            return (
              <div key={p.id} className="card p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div>
                      <h2 className="font-semibold">{p.name}</h2>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-xs)' }}>
                        v{p.version} · {p._count?.tablets ?? 0} tablets · editada {new Date(p.updatedAt).toLocaleDateString('es-AR')}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${adCount > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                      {adCount} {adCount === 1 ? 'anuncio' : 'anuncios'}
                    </span>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-end">
                    <button onClick={() => openEditAds(p)} className="text-blue-600 border border-blue-200 hover:bg-blue-50 dark:hover:bg-blue-950 px-3 py-1.5 rounded-lg text-xs font-medium">Editar anuncios</button>
                    {/* #11 — preview */}
                    <button onClick={() => setPreviewPlaylist(p)} className="text-violet-600 border border-violet-200 hover:bg-violet-50 dark:hover:bg-violet-950 px-3 py-1.5 rounded-lg text-xs font-medium">Vista previa</button>
                    {/* #17 — version history */}
                    <button onClick={() => openVersions(p)} className="text-gray-600 border hover:bg-gray-50 dark:hover:bg-gray-800 px-3 py-1.5 rounded-lg text-xs font-medium" style={{ borderColor: 'var(--border-md)' }}>Versiones</button>
                    <button onClick={() => handleDuplicate(p.id)} disabled={duplicating === p.id} className="text-gray-600 border hover:bg-gray-50 dark:hover:bg-gray-800 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50" style={{ borderColor: 'var(--border-md)' }}>
                      {duplicating === p.id ? 'Duplicando...' : 'Duplicar'}
                    </button>
                    <button onClick={() => setDeleteTarget(p)} className="text-red-500 border border-red-100 hover:bg-red-50 dark:hover:bg-red-950 px-3 py-1.5 rounded-lg text-xs font-medium">Eliminar</button>
                  </div>
                </div>
                {p.playlistAds && p.playlistAds.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {p.playlistAds.map((pa) => (
                      <span key={pa.id} className="text-xs px-2 py-1 rounded-full" style={{ background: 'var(--bg)', color: 'var(--text-muted)' }}>
                        {pa.order + 1}. {pa.ad.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: 'var(--text-xs)' }}>Sin anuncios asignados.</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>
          <span>{filtered.length} playlists · página {page} de {totalPages}</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 rounded border disabled:opacity-40" style={{ borderColor: 'var(--border-md)' }}>‹ Anterior</button>
            <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 rounded border disabled:opacity-40" style={{ borderColor: 'var(--border-md)' }}>Siguiente ›</button>
          </div>
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog title="Eliminar playlist" message={`¿Eliminar "${deleteTarget.name}"?`} confirmLabel="Eliminar" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
      )}

      {/* Edit ads modal */}
      {editingId !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="rounded-xl shadow-xl w-full max-w-lg p-6" style={{ background: 'var(--card)' }}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-lg">Asignar anuncios</h2>
              <button onClick={() => setEditingId(null)} className="text-xl leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
            </div>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>Seleccioná los anuncios y arrastrá para reordenar.</p>
            {selectedAds.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-medium mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Orden de reproducción</p>
                <div className="space-y-1">
                  {selectedAds.map((adId, idx) => {
                    const ad = ads.find(a => a.id === adId);
                    if (!ad) return null;
                    return (
                      <div key={adId} draggable onDragStart={() => handleDragStart(idx)} onDragOver={(e) => handleDragOver(e, idx)}
                        className="flex items-center gap-2 p-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900 cursor-grab active:cursor-grabbing select-none">
                        <span style={{ color: 'var(--text-muted)' }} className="text-sm">⠿</span>
                        <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold shrink-0">{idx + 1}</span>
                        <span className="text-sm font-medium truncate">{ad.name}</span>
                        <span className="text-xs ml-auto" style={{ color: 'var(--text-xs)' }}>{ad.durationS}s</span>
                        <button onClick={() => toggleAd(adId)} className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>✕</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="max-h-52 overflow-y-auto space-y-1 mb-4 border-t pt-3" style={{ borderColor: 'var(--border-md)' }}>
              <p className="text-xs font-medium mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Anuncios disponibles</p>
              {ads.filter(ad => !selectedAds.includes(ad.id)).map((ad) => (
                <button key={ad.id} onClick={() => toggleAd(ad.id)} className="w-full flex items-center gap-3 p-2 rounded-lg border text-left hover:bg-gray-50 dark:hover:bg-gray-800" style={{ borderColor: 'var(--border-md)' }}>
                  <span className="w-4 h-4 rounded border-2 flex-shrink-0" style={{ borderColor: 'var(--border-md)' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{ad.name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-xs)' }}>{ad.campaign?.name} · {ad.durationS}s</p>
                  </div>
                  <span className="text-xs text-blue-600">+ Agregar</span>
                </button>
              ))}
            </div>
            {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
            <div className="flex gap-2">
              <button onClick={handleSaveAds} disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-2 rounded-lg text-sm font-medium">
                {saving ? 'Guardando...' : `Guardar (${selectedAds.length} anuncios)`}
              </button>
              <button onClick={() => setEditingId(null)} className="flex-1 border hover:bg-gray-50 dark:hover:bg-gray-800 py-2 rounded-lg text-sm" style={{ borderColor: 'var(--border-md)' }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* #11 — Playlist preview (simulated tablet screen) */}
      {previewPlaylist && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="rounded-xl shadow-xl w-full max-w-sm p-6" style={{ background: 'var(--card)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">Vista previa: {previewPlaylist.name}</h2>
              <button onClick={() => setPreviewPlaylist(null)} className="text-xl leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
            </div>
            {/* Tablet mockup */}
            <div className="mx-auto w-56 rounded-2xl bg-black p-2 shadow-2xl border-4 border-gray-800">
              <div className="rounded-xl overflow-hidden bg-gray-900 aspect-[9/16] flex flex-col">
                {previewPlaylist.playlistAds && previewPlaylist.playlistAds.length > 0 ? (
                  previewPlaylist.playlistAds.map((pa, i) => (
                    <div key={pa.id} className={`flex-1 flex items-center justify-center text-white text-xs p-2 ${i % 2 === 0 ? 'bg-gray-800' : 'bg-gray-700'}`}>
                      {pa.ad.type === 'image' ? (
                        <img src={`${BASE}${pa.ad.fileUrl}`} alt={pa.ad.name} className="max-h-full max-w-full object-contain" />
                      ) : (
                        <video src={`${BASE}${pa.ad.fileUrl}`} className="max-h-full max-w-full object-contain" muted autoPlay loop />
                      )}
                    </div>
                  ))
                ) : (
                  <div className="flex-1 flex items-center justify-center text-gray-500 text-xs">Sin anuncios</div>
                )}
              </div>
              <div className="mt-1 mx-auto w-8 h-1 bg-gray-700 rounded-full" />
            </div>
            <p className="text-xs text-center mt-3" style={{ color: 'var(--text-muted)' }}>
              {previewPlaylist.playlistAds?.length ?? 0} anuncios · v{previewPlaylist.version}
            </p>
          </div>
        </div>
      )}

      {/* #17 — Version history modal */}
      {versionsPlaylist && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="rounded-xl shadow-xl w-full max-w-md p-6" style={{ background: 'var(--card)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">Versiones: {versionsPlaylist.name}</h2>
              <button onClick={() => setVersionsPlaylist(null)} className="text-xl leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
            </div>
            {versions.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sin historial de versiones.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between p-3 rounded-lg border" style={{ borderColor: 'var(--border-md)' }}>
                    <div>
                      <p className="text-sm font-medium">v{v.version}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {v.snapshot.ads.length} anuncios · {new Date(v.createdAt).toLocaleString('es-AR')}
                        {v.snapshot.revertedFrom && <span className="ml-1 text-amber-600">(revertida de v{v.snapshot.revertedFrom})</span>}
                      </p>
                    </div>
                    {v.version !== versionsPlaylist.version && (
                      <button
                        onClick={() => handleRevert(v.version)}
                        disabled={reverting === v.version}
                        className="text-xs text-blue-600 hover:underline disabled:opacity-40"
                      >
                        {reverting === v.version ? 'Revirtiendo...' : 'Revertir'}
                      </button>
                    )}
                    {v.version === versionsPlaylist.version && (
                      <span className="text-xs text-emerald-600 font-medium">Actual</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
