'use client';

import { useEffect, useRef, useState } from 'react';
import { api, Ad, Campaign, BASE } from '@/lib/api';
import ConfirmDialog from '@/components/ConfirmDialog';

const MAX_SIZE_MB = 100;
const ALLOWED_TYPES = ['video/mp4', 'image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXT = /\.(mp4|jpg|jpeg|png|webp)$/i;
const PAGE_SIZE = 10;

export default function AdsPage() {
  const [ads, setAds] = useState<Ad[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ campaignId: '', name: '', type: 'image', durationS: '10' });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);  // #1
  const [uploadPct, setUploadPct] = useState(0);                 // #3
  const [saving, setSaving] = useState(false);
  const [fileError, setFileError] = useState('');
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Ad | null>(null); // #9
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');  // #33
  const [search, setSearch] = useState('');  // #6
  const [page, setPage] = useState(1);       // #8
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () =>
    Promise.all([api.getAds(), api.getCampaigns()])
      .then(([a, c]) => { setAds(a); setCampaigns(c); })
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  // #6 — search filter
  const filtered = ads.filter((a) => {
    const q = search.toLowerCase();
    return (
      a.name.toLowerCase().includes(q) ||
      (a.campaign?.name ?? '').toLowerCase().includes(q)
    );
  });

  // #8 — pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openCreate = () => {
    setForm({ campaignId: '', name: '', type: 'image', durationS: '10' });
    setFile(null);
    setPreview(null);
    setUploadPct(0);
    setFileError('');
    setError('');
    setShowModal(true);
  };

  // #4/#5 — validate before setting file
  const handleFileChange = (f: File | null) => {
    setFileError('');
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
    setForm((prev) => ({ ...prev, type: /\.mp4$/i.test(f.name) ? 'video' : 'image' }));
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

  const confirmDelete = (ad: Ad) => setDeleteTarget(ad);
  const handleDelete = async () => {
    if (!deleteTarget) return;
    await api.deleteAd(deleteTarget.id).catch(() => {});
    setDeleteTarget(null);
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

      {/* Search + view toggle */}
      <div className="flex gap-3 mb-4">
        <input
          className="input flex-1 max-w-xs"
          placeholder="Buscar por nombre o campaña..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
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
        <p className="text-gray-500">{search ? 'Sin resultados.' : 'No hay anuncios.'}</p>
      ) : viewMode === 'grid' ? (
        /* GRID VIEW */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {paged.map((ad) => (
            <div key={ad.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              {/* #11 — thumbnail */}
              <div className="h-36 bg-gray-100 flex items-center justify-center overflow-hidden">
                {ad.type === 'image' ? (
                  <img src={`${BASE}${ad.fileUrl}`} alt={ad.name} className="h-full w-full object-cover" />
                ) : (
                  <video src={`${BASE}${ad.fileUrl}`} className="h-full w-full object-cover" muted />
                )}
              </div>
              <div className="p-4">
                <p className="font-medium text-sm truncate">{ad.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{ad.campaign?.name} · {ad.durationS}s</p>
                <div className="flex items-center justify-between mt-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ad.type === 'video' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>
                    {ad.type}
                  </span>
                  <button onClick={() => confirmDelete(ad)} className="text-red-500 hover:underline text-xs">Desactivar</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* LIST VIEW — #11 thumbnail column */
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 font-medium text-gray-600 w-16">Preview</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Campaña</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Tipo</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Duración</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {paged.map((ad) => (
                <tr key={ad.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <div className="w-12 h-8 rounded overflow-hidden bg-gray-100">
                      {ad.type === 'image' ? (
                        <img src={`${BASE}${ad.fileUrl}`} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <video src={`${BASE}${ad.fileUrl}`} className="w-full h-full object-cover" muted />
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
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => confirmDelete(ad)} className="text-red-500 hover:underline text-xs">Desactivar</button>
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

      {/* #9 — delete confirmation modal */}
      {deleteTarget && (
        <ConfirmDialog
          title="Desactivar anuncio"
          message={`¿Desactivar "${deleteTarget.name}"? Dejará de aparecer en las playlists.`}
          confirmLabel="Desactivar"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Upload modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">Subir anuncio</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="space-y-4">
              {/* File picker */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Archivo <span className="text-gray-400 font-normal">(mp4, jpg, png, webp · máx {MAX_SIZE_MB}MB)</span>
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

              {/* #1 — preview */}
              {preview && (
                <div className="rounded-lg overflow-hidden bg-gray-100 max-h-40">
                  {form.type === 'video' ? (
                    <video src={preview} controls className="w-full max-h-40 object-contain" />
                  ) : (
                    <img src={preview} alt="preview" className="w-full max-h-40 object-contain" />
                  )}
                </div>
              )}

              {/* #3 — progress bar */}
              {saving && (
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
                <select className="input" value={form.campaignId} onChange={(e) => setForm({ ...form, campaignId: e.target.value })}>
                  <option value="">Seleccionar campaña</option>
                  {campaigns.filter(c => c.active).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
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
                  <input type="number" min="1" className="input" value={form.durationS} onChange={(e) => setForm({ ...form, durationS: e.target.value })} />
                </div>
              </div>
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <div className="flex gap-2 pt-2">
                <button onClick={handleUpload} disabled={saving || !!fileError} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-2 rounded-lg text-sm font-medium">
                  {saving ? `Subiendo ${uploadPct}%` : 'Subir'}
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
