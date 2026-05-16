'use client';

import { useEffect, useRef, useState } from 'react';
import { api, Ad, Campaign } from '@/lib/api';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export default function AdsPage() {
  const [ads, setAds] = useState<Ad[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ campaignId: '', name: '', type: 'image', durationS: '10' });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () =>
    Promise.all([api.getAds(), api.getCampaigns()])
      .then(([a, c]) => { setAds(a); setCampaigns(c); })
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setForm({ campaignId: '', name: '', type: 'image', durationS: '10' });
    setFile(null);
    setError('');
    setShowModal(true);
  };

  const handleUpload = async () => {
    if (!file) { setError('Seleccioná un archivo'); return; }
    if (!form.campaignId) { setError('Seleccioná una campaña'); return; }
    setSaving(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('campaignId', form.campaignId);
      fd.append('name', form.name || file.name);
      fd.append('type', form.type);
      fd.append('durationS', form.durationS);
      await api.uploadAd(fd);
      setShowModal(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al subir');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('¿Desactivar este anuncio?')) return;
    await api.deleteAd(id).catch(() => {});
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Anuncios</h1>
        <button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          + Subir anuncio
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500">Cargando...</p>
      ) : ads.length === 0 ? (
        <p className="text-gray-500">No hay anuncios.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ads.map((ad) => (
            <div key={ad.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="h-36 bg-gray-100 flex items-center justify-center">
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
                  <button onClick={() => handleDelete(ad.id)} className="text-red-500 hover:underline text-xs">Desactivar</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">Subir anuncio</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Archivo</label>
                <div
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 transition-colors"
                >
                  {file ? (
                    <p className="text-sm text-gray-700 font-medium">{file.name}</p>
                  ) : (
                    <p className="text-sm text-gray-400">Hacé clic para seleccionar imagen o video</p>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".mp4,.webm,.jpg,.jpeg,.png,.gif,.webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setFile(f);
                    if (f && !form.name) setForm((prev) => ({ ...prev, name: f.name.replace(/\.[^.]+$/, '') }));
                    if (f) setForm((prev) => ({ ...prev, type: /\.(mp4|webm)$/i.test(f.name) ? 'video' : 'image' }));
                  }}
                />
              </div>
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
                <button onClick={handleUpload} disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-2 rounded-lg text-sm font-medium">
                  {saving ? 'Subiendo...' : 'Subir'}
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
