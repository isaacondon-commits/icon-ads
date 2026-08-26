'use client';

import { useEffect, useRef, useState } from 'react';
import { api, Ad, Campaign, BASE, StorageStats } from '@/lib/api';
import ConfirmDialog from '@/components/ConfirmDialog';

const MAX_SIZE_MB = 100;
const mediaUrl = (fileUrl: string) => fileUrl.startsWith('http') ? fileUrl : `${BASE}${fileUrl}`;
const ALLOWED_TYPES = ['video/mp4', 'image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXT = /\.(mp4|jpg|jpeg|png|webp)$/i;
const PAGE_SIZE = 10;

// Estados como pestañas — un anuncio vive en una sola a la vez, así pausar/
// aprobar/rechazar lo "mueve" de pestaña sin mezclarlo con el resto.
const AD_TABS = [
  { id: 'all', label: 'Todos', match: () => true },
  { id: 'active', label: 'Activos', match: (a: Ad) => a.approvalStatus === 'approved' && a.active },
  { id: 'paused', label: 'Pausados', match: (a: Ad) => a.approvalStatus === 'approved' && !a.active },
  { id: 'pending', label: 'Pendientes', match: (a: Ad) => a.approvalStatus === 'pending' },
  { id: 'rejected', label: 'Rechazados', match: (a: Ad) => a.approvalStatus === 'rejected' },
] as const;
type AdTabId = typeof AD_TABS[number]['id'];

// Captures a frame from a video file as a JPEG blob, entirely client-side —
// avoids needing ffmpeg on the backend just to generate a poster thumbnail.
// Resolves null (never rejects) if anything goes wrong, since a missing
// thumbnail should never block the ad upload — it just falls back to the
// placeholder icon.
function generateVideoThumbnail(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    video.src = url;
    let settled = false;
    const finish = (result: Blob | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(result);
    };
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, (video.duration || 2) / 2);
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx || canvas.width === 0) return finish(null);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => finish(blob), 'image/jpeg', 0.75);
      } catch {
        finish(null);
      }
    };
    video.onerror = () => finish(null);
    setTimeout(() => finish(null), 8000);
  });
}

export default function AdsPage() {
  const [ads, setAds] = useState<Ad[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Ad | null>(null);
  const [form, setForm] = useState({ campaignId: '', name: '', type: 'image', durationS: '10', priority: '0', targetUrl: '', tags: '' });
  const [playerUrl, setPlayerUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);  // #1
  const [thumbnailBlob, setThumbnailBlob] = useState<Blob | null>(null);
  const [uploadPct, setUploadPct] = useState(0);                 // #3
  const [saving, setSaving] = useState(false);
  const [fileError, setFileError] = useState('');
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Ad | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [activeTab, setActiveTab] = useState<AdTabId>('active');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [pausingId, setPausingId] = useState<number | null>(null);
  const [hoveredAdId, setHoveredAdId] = useState<number | null>(null);
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () =>
    Promise.all([api.getAds(), api.getCampaigns(), api.getAdTags()])
      .then(([a, c, t]) => { setAds(a); setCampaigns(c); setAllTags(t); })
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);
  useEffect(() => { api.getStorageStats().then(setStorage).catch(() => {}); }, [ads.length]);

  // #6 — search + tag filter + status tab
  const activeTabDef = AD_TABS.find((t) => t.id === activeTab)!;
  const filtered = ads.filter((a) => {
    const q = search.toLowerCase();
    const matchSearch = a.name.toLowerCase().includes(q) || (a.campaign?.name ?? '').toLowerCase().includes(q);
    const matchTag = !tagFilter || (a.tags ?? []).includes(tagFilter);
    return matchSearch && matchTag && activeTabDef.match(a);
  });

  // #8 — pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openCreate = () => {
    setEditing(null);
    setForm({ campaignId: '', name: '', type: 'image', durationS: '10', priority: '0', targetUrl: '', tags: '' });
    setFile(null);
    setPreview(null);
    setThumbnailBlob(null);
    setUploadPct(0);
    setFileError('');
    setError('');
    setShowModal(true);
  };

  const openEdit = (ad: Ad) => {
    setEditing(ad);
    setForm({
      campaignId: ad.campaignId.toString(),
      name: ad.name,
      type: ad.type,
      durationS: ad.durationS.toString(),
      priority: ad.priority.toString(),
      targetUrl: ad.targetUrl ?? '',
      tags: (ad.tags ?? []).join(', '),
    });
    setFile(null);
    setPreview(null);
    setThumbnailBlob(null);
    setFileError('');
    setError('');
    setShowModal(true);
  };

  // #4/#5 — validate before setting file
  const handleFileChange = (f: File | null) => {
    setFileError('');
    setThumbnailBlob(null);
    if (!f) { setFile(null); setPreview(null); return; }

    if (!ALLOWED_EXT.test(f.name) && !ALLOWED_TYPES.includes(f.type)) {
      setFileError('Formato no permitido. Solo: mp4, jpg, png, webp');
      setFile(null);
      setPreview(null);
      return;
    }
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      setFileError(`El archivo supera el límite de ${MAX_SIZE_MB} MB`);
      setFile(null);
      setPreview(null);
      return;
    }

    setFile(f);
    // #1 — generate preview URL
    const url = URL.createObjectURL(f);
    setPreview(url);
    if (!form.name) setForm((prev) => ({ ...prev, name: f.name.replace(/\.[^.]+$/, '') }));
    const isVideo = /\.mp4$/i.test(f.name);
    setForm((prev) => ({ ...prev, type: isVideo ? 'video' : 'image' }));
    if (isVideo) generateVideoThumbnail(f).then(setThumbnailBlob);
  };

  // #3 — upload with progress via XHR
  const handleUpload = async () => {
    if (!file) { setError('Seleccioná un archivo'); return; }
    if (!form.campaignId) { setError('Seleccioná una campaña'); return; }
    setSaving(true);
    setError('');
    setUploadPct(0);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('campaignId', form.campaignId);
      fd.append('name', form.name || file.name);
      fd.append('type', form.type);
      fd.append('durationS', form.durationS);
      fd.append('priority', form.priority || '0');
      if (form.targetUrl) fd.append('targetUrl', form.targetUrl);
      if (form.tags) fd.append('tags', form.tags);
      if (thumbnailBlob) fd.append('thumbnail', thumbnailBlob, 'thumb.jpg');
      await api.uploadAdWithProgress(fd, setUploadPct);
      setShowModal(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al subir');
    } finally {
      setSaving(false);
      setUploadPct(0);
    }
  };

  const handleUpdate = async () => {
    if (!editing) return;
    setSaving(true);
    setError('');
    try {
      await api.updateAd(editing.id, {
        name: form.name,
        type: form.type as 'video' | 'image',
        durationS: Number(form.durationS),
        priority: Number(form.priority || '0'),
        targetUrl: form.targetUrl || null,
        tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      });
      setShowModal(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (ad: Ad) => setDeleteTarget(ad);
  const handleDelete = async () => {
    if (!deleteTarget) return;
    await api.deleteAd(deleteTarget.id).catch(() => {});
    setDeleteTarget(null);
    load();
  };

  // #26 — approve/reject
  const handleApprove = async (id: number) => {
    setApprovingId(id);
    await api.approveAd(id).catch(() => {});
    setApprovingId(null);
    load();
  };
  const handleReject = async (id: number) => {
    setApprovingId(id);
    await api.rejectAd(id).catch(() => {});
    setApprovingId(null);
    load();
  };

  const handleTogglePause = async (ad: Ad) => {
    setPausingId(ad.id);
    try {
      if (ad.active) await api.pauseAd(ad.id);
      else await api.resumeAd(ad.id);
    } catch { /* ignore */ }
    setPausingId(null);
    load();
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Anuncios</h1>
        <button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          + Subir anuncio
        </button>
      </div>

      {/* Estados como pestañas */}
      <div className="flex flex-wrap gap-2 mb-4">
        {AD_TABS.map((t) => {
          const count = ads.filter(t.match).length;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => { setActiveTab(t.id); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                isActive ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t.label} <span className={isActive ? 'text-blue-100' : 'text-gray-400'}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Storage usage bar */}
      {storage && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-4">
          <div className="flex justify-between text-xs text-gray-500 mb-1.5">
            <span>{storage.totalMB} MB usados{storage.quotaMB ? ` de ${storage.quotaMB >= 1024 ? `${(storage.quotaMB / 1024).toFixed(1)} GB` : `${storage.quotaMB} MB`}` : ''}</span>
            <span>{storage.fileCount} archivos{storage.usedPct != null ? ` · ${storage.usedPct}%` : ''}</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-700 ${(storage.usedPct ?? 0) > 90 ? 'bg-red-500' : (storage.usedPct ?? 0) > 70 ? 'bg-amber-500' : 'bg-blue-500'}`}
              style={{ width: `${Math.min(100, storage.usedPct ?? 0)}%` }}
            />
          </div>
          {(storage.usedPct ?? 0) > 90 && (
            <p className="text-xs text-red-600 mt-1.5">Espacio casi agotado — borrá o pausá anuncios que ya no uses.</p>
          )}
        </div>
      )}

      {/* Search + tag filter + view toggle */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          className="input flex-1 max-w-xs"
          placeholder="Buscar por nombre o campaña..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        {allTags.length > 0 && (
          <select className="input w-auto" value={tagFilter} onChange={(e) => { setTagFilter(e.target.value); setPage(1); }}>
            <option value="">Todos los tags</option>
            {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {/* #33 — grid/list toggle */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          <button
            onClick={() => setViewMode('grid')}
            className={`px-3 py-2 text-sm ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            ⊞ Grilla
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-2 text-sm border-l border-gray-200 ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            ≡ Lista
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">Cargando...</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-500">{search ? 'Sin resultados.' : `No hay anuncios en "${activeTabDef.label}".`}</p>
      ) : viewMode === 'grid' ? (
        /* GRID VIEW */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {paged.map((ad) => (
            <div key={ad.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              {/* #11 — thumbnail, hover to preview video, click for full preview */}
              <div
                className="h-36 bg-gray-100 flex items-center justify-center overflow-hidden cursor-pointer relative group"
                onClick={() => setPlayerUrl(mediaUrl(ad.fileUrl))}
                onMouseEnter={() => setHoveredAdId(ad.id)}
                onMouseLeave={() => setHoveredAdId(null)}
              >
                {ad.type === 'image' ? (
                  <img src={mediaUrl(ad.fileUrl)} alt={ad.name} className="h-full w-full object-cover" />
                ) : hoveredAdId === ad.id ? (
                  <video
                    src={mediaUrl(ad.fileUrl)}
                    className="h-full w-full object-cover"
                    muted autoPlay loop playsInline
                  />
                ) : ad.thumbnailUrl ? (
                  <div className="relative w-full h-full">
                    <img src={mediaUrl(ad.thumbnailUrl)} alt={ad.name} className="h-full w-full object-cover" />
                    <span className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">▶</span>
                  </div>
                ) : (
                  <div className="w-full h-full bg-gray-800 flex flex-col items-center justify-center gap-1 group-hover:bg-gray-700 transition-colors">
                    <span className="text-white text-3xl">▶</span>
                    <span className="text-gray-400 text-xs">Video</span>
                  </div>
                )}
              </div>
              <div className="p-4">
                <p className="font-medium text-sm truncate">{ad.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{ad.campaign?.name} · {ad.durationS}s</p>
                {(ad.tags ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {ad.tags.map((t) => (
                      <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 cursor-pointer" onClick={(e) => { e.stopPropagation(); setTagFilter(t); }}>{t}</span>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between mt-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ad.type === 'video' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>
                    {ad.type}
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    {ad.approvalStatus === 'pending' && (
                      <>
                        <button onClick={() => handleApprove(ad.id)} disabled={approvingId === ad.id} className="text-xs text-emerald-600 hover:underline disabled:opacity-40">Aprobar</button>
                        <button onClick={() => handleReject(ad.id)} disabled={approvingId === ad.id} className="text-xs text-red-500 hover:underline disabled:opacity-40">Rechazar</button>
                      </>
                    )}
                    {ad.approvalStatus === 'rejected' && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Rechazado</span>}
                    {ad.approvalStatus === 'approved' && (
                      <button onClick={() => handleTogglePause(ad)} disabled={pausingId === ad.id} className={`text-xs hover:underline disabled:opacity-40 ${ad.active ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {pausingId === ad.id ? '...' : ad.active ? 'Pausar' : 'Reanudar'}
                      </button>
                    )}
                    <button onClick={() => openEdit(ad)} className="text-xs text-blue-600 hover:underline">Editar</button>
                    <button onClick={() => confirmDelete(ad)} className="text-xs text-red-500 hover:underline">Eliminar</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* LIST VIEW — #11 thumbnail column */
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 font-medium text-gray-600 w-16">Preview</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Campaña</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Tipo</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Duración</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Tags</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {paged.map((ad) => (
                <tr key={ad.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <div
                      className="w-12 h-8 rounded overflow-hidden bg-gray-100 cursor-pointer relative group"
                      onClick={() => setPlayerUrl(mediaUrl(ad.fileUrl))}
                      onMouseEnter={() => setHoveredAdId(ad.id)}
                      onMouseLeave={() => setHoveredAdId(null)}
                    >
                      {ad.type === 'image' ? (
                        <img src={mediaUrl(ad.fileUrl)} alt="" className="w-full h-full object-cover" />
                      ) : hoveredAdId === ad.id ? (
                        <video
                          src={mediaUrl(ad.fileUrl)}
                          className="w-full h-full object-cover"
                          muted autoPlay loop playsInline
                        />
                      ) : ad.thumbnailUrl ? (
                        <img src={mediaUrl(ad.thumbnailUrl)} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-gray-800 flex items-center justify-center group-hover:bg-gray-700 transition-colors">
                          <span className="text-white text-xs">▶</span>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium max-w-xs truncate">{ad.name}</td>
                  <td className="px-4 py-3 text-gray-500">{ad.campaign?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ad.type === 'video' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>
                      {ad.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{ad.durationS}s</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(ad.tags ?? []).map((t) => (
                        <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 cursor-pointer" onClick={() => { setTagFilter(t); }}>{t}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center gap-2 justify-end">
                      {ad.approvalStatus === 'pending' && (
                        <>
                          <button onClick={() => handleApprove(ad.id)} disabled={approvingId === ad.id} className="text-xs text-emerald-600 hover:underline disabled:opacity-40">Aprobar</button>
                          <button onClick={() => handleReject(ad.id)} disabled={approvingId === ad.id} className="text-xs text-red-500 hover:underline disabled:opacity-40">Rechazar</button>
                        </>
                      )}
                      {ad.approvalStatus === 'rejected' && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Rechazado</span>}
                      {ad.approvalStatus === 'approved' && (
                        <button onClick={() => handleTogglePause(ad)} disabled={pausingId === ad.id} className={`text-xs hover:underline disabled:opacity-40 ${ad.active ? 'text-amber-600' : 'text-emerald-600'}`}>
                          {pausingId === ad.id ? '...' : ad.active ? 'Pausar' : 'Reanudar'}
                        </button>
                      )}
                      <button onClick={() => openEdit(ad)} className="text-xs text-blue-600 hover:underline">Editar</button>
                      <button onClick={() => confirmDelete(ad)} className="text-xs text-red-500 hover:underline">Eliminar</button>
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
          <span>{filtered.length} anuncios · página {page} de {totalPages}</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">‹ Anterior</button>
            <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Siguiente ›</button>
          </div>
        </div>
      )}

      {/* Video player modal */}
      {playerUrl && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setPlayerUrl(null)}>
          <div className="relative max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setPlayerUrl(null)}
              className="absolute -top-8 right-0 text-white text-2xl leading-none hover:text-gray-300"
            >×</button>
            {/\.(jpg|jpeg|png|webp)(\?|$)/i.test(playerUrl) ? (
              <img src={playerUrl} alt="preview" className="w-full rounded-lg" />
            ) : (
              <video src={playerUrl} controls autoPlay className="w-full rounded-lg" />
            )}
          </div>
        </div>
      )}

      {/* #9 — delete confirmation modal */}
      {deleteTarget && (
        <ConfirmDialog
          title="Eliminar anuncio"
          message={`¿Eliminar "${deleteTarget.name}"? Dejará de aparecer en las playlists.`}
          confirmLabel="Eliminar"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Upload / edit modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">{editing ? 'Editar anuncio' : 'Subir anuncio'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="space-y-4">
              {/* File picker — solo al subir; el archivo no se reemplaza al editar */}
              {!editing && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Archivo <span className="text-gray-400 font-normal">(mp4, jpg, png, webp · máx {MAX_SIZE_MB}MB · recomendado 1280×720)</span>
                </label>
                <div
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 transition-colors"
                >
                  {file ? (
                    <p className="text-sm text-gray-700 font-medium">{file.name}</p>
                  ) : (
                    <p className="text-sm text-gray-400">Clic o arrastrá para seleccionar</p>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".mp4,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                />
                {fileError && <p className="text-red-500 text-xs mt-1">{fileError}</p>}
              </div>
              )}

              {/* #1 — preview */}
              {!editing && preview && (
                <div className="rounded-lg overflow-hidden bg-gray-100 max-h-40">
                  {form.type === 'video' ? (
                    <video src={preview} controls className="w-full max-h-40 object-contain" />
                  ) : (
                    <img src={preview} alt="preview" className="w-full max-h-40 object-contain" />
                  )}
                </div>
              )}

              {/* #3 — progress bar */}
              {!editing && saving && (
                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Subiendo...</span>
                    <span>{uploadPct}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-200"
                      style={{ width: `${uploadPct}%` }}
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Campaña</label>
                {editing ? (
                  <p className="text-sm text-gray-500 py-2">{editing.campaign?.name ?? '—'} <span className="text-xs text-gray-400">(no se puede cambiar acá)</span></p>
                ) : (
                  <select className="input" value={form.campaignId} onChange={(e) => setForm({ ...form, campaignId: e.target.value })}>
                    <option value="">Seleccionar campaña</option>
                    {campaigns.filter(c => c.active).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nombre del anuncio" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                  <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    <option value="image">Imagen</option>
                    <option value="video">Video</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Duración (s)</label>
                  <input type="number" min="1" className="input" value={form.durationS} onChange={(e) => setForm({ ...form, durationS: e.target.value })} onWheel={(e) => e.currentTarget.blur()} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prioridad <span className="text-gray-400 font-normal">(0 = normal)</span></label>
                  <input type="number" min="0" max="100" className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} onWheel={(e) => e.currentTarget.blur()} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">URL destino <span className="text-gray-400 font-normal">(opcional)</span></label>
                  <input type="url" className="input" value={form.targetUrl} onChange={(e) => setForm({ ...form, targetUrl: e.target.value })} placeholder="https://..." />
                </div>
              </div>
              {/* #16 — tags */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tags <span className="text-gray-400 font-normal">(opcional, separados por coma)</span></label>
                <input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="Ej: promo, verano, cliente-abc" />
              </div>
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <div className="flex gap-2 pt-2">
                <button onClick={editing ? handleUpdate : handleUpload} disabled={saving || !!fileError} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-2 rounded-lg text-sm font-medium">
                  {editing ? (saving ? 'Guardando...' : 'Guardar') : (saving ? `Subiendo ${uploadPct}%` : 'Subir')}
                </button>
                <button onClick={() => setShowModal(false)} className="flex-1 border border-gray-200 hover:bg-gray-50 py-2 rounded-lg text-sm">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
