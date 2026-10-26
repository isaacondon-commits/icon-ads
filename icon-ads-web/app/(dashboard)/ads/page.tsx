'use client';

import { useEffect, useRef, useState } from 'react';
import { api, Ad, Campaign, StorageStats } from '@/lib/api';
import PageShell from '@/components/ui/PageShell';
import { Btn, TabPill } from '@/components/ui/buttons';
import { AdList, AdViewer, AdActionHandlers, hasNoCampaign, neverPlayed } from '@/components/AdViews';
import ConfirmDialog from '@/components/ConfirmDialog';
import RefreshButton from '@/components/RefreshButton';
import { useRole } from '@/lib/roles';

const MAX_SIZE_MB = 100;
const ALLOWED_TYPES = ['video/mp4', 'image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXT = /\.(mp4|jpg|jpeg|png|webp)$/i;
const PAGE_SIZE = 25;

// Estados como pestañas — un anuncio vive en una sola a la vez, así pausar/
// aprobar/rechazar lo "mueve" de pestaña sin mezclarlo con el resto.
const AD_TABS = [
  { id: 'all', label: 'Todos', match: () => true },
  { id: 'active', label: 'Activos', match: (a: Ad) => a.approvalStatus === 'approved' && a.active },
  { id: 'paused', label: 'Pausados', match: (a: Ad) => a.approvalStatus === 'approved' && !a.active },
  { id: 'pending', label: 'Pendientes', match: (a: Ad) => a.approvalStatus === 'pending' },
  { id: 'rejected', label: 'Rechazados', match: (a: Ad) => a.approvalStatus === 'rejected' },
  // Pestañas de alerta: sólo aparecen (en rojo) cuando tienen algo.
  { id: 'never', label: 'Nunca pasaron', match: (a: Ad) => neverPlayed(a), alert: true },
  { id: 'nocampaign', label: 'Sin campaña', match: (a: Ad) => hasNoCampaign(a), alert: true },
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

// Un archivo dentro de una subida múltiple, con su propio estado/progreso.
type BatchItem = {
  file: File;
  name: string;
  type: 'video' | 'image';
  durationS: number;
  videoLen?: number;
  thumbnail: Blob | null;
  status: 'pending' | 'uploading' | 'done' | 'error';
  pct: number;
  error?: string;
  invalid?: boolean;
};

export default function AdsPage() {
  const [ads, setAds] = useState<Ad[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Ad | null>(null);
  const [form, setForm] = useState({ campaignId: '', name: '', type: 'image', durationS: '10', priority: '0', targetUrl: '', tags: '' });
  const [viewAd, setViewAd] = useState<Ad | null>(null);
  // Eliminar varios: null = modo normal; Set = modo selección activo.
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);  // #1
  const [thumbnailBlob, setThumbnailBlob] = useState<Blob | null>(null);
  // Subida múltiple: cuando se eligen 2+ archivos, cada uno se sube por
  // separado heredando campaña / prioridad / URL / tags del formulario.
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [batchDurAll, setBatchDurAll] = useState('');
  const [uploadPct, setUploadPct] = useState(0);                 // #3
  const [saving, setSaving] = useState(false);
  const [fileError, setFileError] = useState('');
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Ad | null>(null);
  const [activeTab, setActiveTab] = useState<AdTabId>('active');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const [confirmApproveAll, setConfirmApproveAll] = useState(false);
  const [pausingId, setPausingId] = useState<number | null>(null);
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () =>
    Promise.all([api.getAds(), api.getCampaigns(), api.getAdTags()])
      .then(([a, c, t]) => { setAds(a); setCampaigns(c); setAllTags(t); })
      .finally(() => setLoading(false));

  const { canCreateContent, canManage } = useRole();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } };

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
    setBatch([]);
    setBatchDurAll('');
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
      campaignId: ad.campaign && !ad.campaign.deletedAt ? ad.campaignId.toString() : '',
      name: ad.name,
      type: ad.type,
      durationS: ad.durationS.toString(),
      priority: ad.priority.toString(),
      targetUrl: ad.targetUrl ?? '',
      tags: (ad.tags ?? []).join(', '),
    });
    setFile(null);
    setBatch([]);
    setBatchDurAll('');
    setPreview(null);
    setThumbnailBlob(null);
    setFileError('');
    setError('');
    setShowModal(true);
  };

  const [videoDuration, setVideoDuration] = useState<number | null>(null);

  // Lee la duración real de un video en el navegador.
  const readVideoDuration = (f: File): Promise<number | null> =>
    new Promise((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => { const d = v.duration; URL.revokeObjectURL(v.src); resolve(Number.isFinite(d) ? d : null); };
      v.onerror = () => { URL.revokeObjectURL(v.src); resolve(null); };
      v.src = URL.createObjectURL(f);
    });

  // #4/#5 — validate before setting file
  const handleFileChange = (f: File | null) => {
    setFileError('');
    setThumbnailBlob(null);
    setVideoDuration(null);
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
    if (isVideo) {
      generateVideoThumbnail(f).then(setThumbnailBlob);
      readVideoDuration(f).then((d) => {
        setVideoDuration(d);
        // Sugerir la duración real si el campo sigue en el default.
        if (d != null && (form.durationS === '10' || form.durationS === '')) {
          setForm((prev) => ({ ...prev, durationS: String(Math.round(d)) }));
        }
      });
    }
  };

  // #3 — upload with progress via XHR
  const handleUpload = async () => {
    if (!file) { setError('Seleccioná un archivo'); return; }
    if (!form.campaignId) { setError('Seleccioná una campaña'); return; }
    if (videoDuration != null && videoDuration > Number(form.durationS) + 0.5) {
      setError(`El video dura ${videoDuration.toFixed(1)}s pero configuraste ${form.durationS}s. `
        + `Subí un video más corto o poné la duración real (${Math.round(videoDuration)}s).`);
      return;
    }
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

  // Arma la lista de la subida múltiple: valida cada archivo y, para los
  // videos, resuelve la duración real antes de habilitar el envío.
  const buildBatch = async (files: File[]) => {
    setError('');
    setFileError('');
    setFile(null);
    setPreview(null);
    setThumbnailBlob(null);
    setVideoDuration(null);
    const items = await Promise.all(files.map(async (f): Promise<BatchItem> => {
      const isVideo = /\.mp4$/i.test(f.name) || f.type === 'video/mp4';
      let invalid: string | undefined;
      if (!ALLOWED_EXT.test(f.name) && !ALLOWED_TYPES.includes(f.type)) invalid = 'Formato no permitido';
      else if (f.size > MAX_SIZE_MB * 1024 * 1024) invalid = `Supera ${MAX_SIZE_MB} MB`;
      let durationS = 10;
      let videoLen: number | undefined;
      if (!invalid && isVideo) {
        const d = await readVideoDuration(f);
        if (d != null) { videoLen = d; durationS = Math.max(1, Math.ceil(d)); }
      }
      return {
        file: f,
        name: f.name.replace(/\.[^.]+$/, ''),
        type: isVideo ? 'video' : 'image',
        durationS,
        videoLen,
        thumbnail: null,
        status: invalid ? 'error' : 'pending',
        pct: 0,
        error: invalid,
        invalid: !!invalid,
      };
    }));
    setBatch(items);
    items.forEach((item, i) => {
      if (item.invalid || item.type !== 'video') return;
      generateVideoThumbnail(item.file).then((blob) =>
        setBatch((prev) => prev.map((b, idx) => (idx === i ? { ...b, thumbnail: blob } : b))));
    });
  };

  const setBatchDuration = (i: number, v: string) =>
    setBatch((prev) => prev.map((b, idx) => (idx === i
      ? { ...b, durationS: v === '' ? 0 : Math.max(0, Math.floor(Number(v) || 0)) }
      : b)));

  const applyDurationToAll = () => {
    const n = Math.max(1, Math.floor(Number(batchDurAll) || 0));
    if (!n) return;
    setBatch((prev) => prev.map((b) => (b.invalid ? b : { ...b, durationS: n })));
  };

  // ¿Alguna fila a subir tiene duración inválida (0 o menor que el video)?
  const durTooShort = (b: BatchItem) => b.videoLen != null && b.durationS < Math.ceil(b.videoLen);
  const batchDurError = batch.some((b) => !b.invalid && b.status !== 'done' && (!b.durationS || durTooShort(b)));

  const handleBatchUpload = async () => {
    if (!form.campaignId) { setError('Seleccioná una campaña'); return; }
    const queue = batch
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => !b.invalid && b.status !== 'done');
    if (queue.length === 0) { setError('No hay archivos válidos para subir'); return; }
    if (queue.some(({ b }) => !b.durationS || durTooShort(b))) {
      setError('Revisá la duración: no puede ser 0 ni menor que la del video.');
      return;
    }
    setSaving(true);
    setError('');
    let ok = 0;
    let failed = 0;
    for (const { b, i } of queue) {
      setBatch((prev) => prev.map((x, idx) => (idx === i ? { ...x, status: 'uploading', pct: 0, error: undefined } : x)));
      try {
        const fd = new FormData();
        fd.append('file', b.file);
        fd.append('campaignId', form.campaignId);
        fd.append('name', b.name || b.file.name);
        fd.append('type', b.type);
        fd.append('durationS', String(b.durationS));
        fd.append('priority', form.priority || '0');
        if (form.targetUrl) fd.append('targetUrl', form.targetUrl);
        if (form.tags) fd.append('tags', form.tags);
        if (b.thumbnail) fd.append('thumbnail', b.thumbnail, 'thumb.jpg');
        await api.uploadAdWithProgress(fd, (p) =>
          setBatch((prev) => prev.map((x, idx) => (idx === i ? { ...x, pct: p } : x))));
        setBatch((prev) => prev.map((x, idx) => (idx === i ? { ...x, status: 'done', pct: 100 } : x)));
        ok++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error al subir';
        setBatch((prev) => prev.map((x, idx) => (idx === i ? { ...x, status: 'error', error: msg } : x)));
        failed++;
      }
    }
    setSaving(false);
    load();
    if (failed === 0) {
      setShowModal(false);
      setBatch([]);
    } else {
      setError(`${ok} subido(s), ${failed} con error. Podés reintentar los que fallaron.`);
    }
  };

  const handleUpdate = async () => {
    if (!editing) return;
    if (!form.campaignId) { setError('Seleccioná una campaña'); return; }
    setSaving(true);
    setError('');
    try {
      await api.updateAd(editing.id, {
        campaignId: Number(form.campaignId),
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

  const toggleSelected = (id: number) => setSelected((prev) => {
    const next = new Set(prev ?? []);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const handleBulkDelete = async () => {
    if (!selected?.size) return;
    setBulkDeleting(true);
    try {
      await api.bulkDeleteAds([...selected]);
      setSelected(null);
      setConfirmBulk(false);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error al eliminar');
    } finally {
      setBulkDeleting(false);
    }
  };
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
  const handleApproveAll = async () => {
    const pending = ads.filter((a) => a.approvalStatus === 'pending');
    if (pending.length === 0) { setConfirmApproveAll(false); return; }
    setApprovingAll(true);
    await Promise.allSettled(pending.map((a) => api.approveAd(a.id)));
    setApprovingAll(false);
    setConfirmApproveAll(false);
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

  const handlers: AdActionHandlers = {
    canManage,
    busyId: approvingId ?? pausingId,
    onView: setViewAd,
    onApprove: (ad) => handleApprove(ad.id),
    onReject: (ad) => handleReject(ad.id),
    onTogglePause: handleTogglePause,
    onEdit: openEdit,
    onDelete: confirmDelete,
    onTag: (t) => { setTagFilter(t); setPage(1); },
  };

  const formatTotal = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  const totalBytes = ads.reduce((n, a) => n + (a.fileSize ?? 0), 0);

  return (
    <PageShell
      title="Anuncios"
      subtitle={loading ? 'Cargando…' : `${ads.length} anuncios · ${formatTotal(totalBytes)}`}
      actions={(
        <>
          <RefreshButton onClick={refresh} loading={refreshing} />
          {canCreateContent && <Btn icon="plus" v="primary" onClick={openCreate}>Subir anuncio</Btn>}
        </>
      )}
    >
      {/* Estados como pestañas */}
      <div className="flex flex-wrap gap-2 mb-5">
        {AD_TABS.map((t) => {
          const count = ads.filter(t.match).length;
          const isActive = activeTab === t.id;
          const alertTab = 'alert' in t && t.alert;
          if (alertTab && count === 0 && !isActive) return null;
          const isAlert = alertTab && count > 0;
          const tab = (
            <TabPill key={t.id} active={isActive} alert={isAlert} count={count} onClick={() => { setActiveTab(t.id); setPage(1); }}>
              {t.label}
            </TabPill>
          );
          if (!isAlert) return tab;
          // Al pasar el mouse (o con foco de teclado) muestra el detalle.
          return (
            <div key={t.id} className="relative group">
              {tab}
              <div role="tooltip" className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-80 group-hover:block group-focus-within:block">
                <AlertTip tab={t.id} ads={ads} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Aprobar todo — solo en la pestaña Pendientes */}
      {activeTab === 'pending' && ads.some((a) => a.approvalStatus === 'pending') && (
        <div className="mb-4">
          <Btn icon="check" v="ok" onClick={() => setConfirmApproveAll(true)} disabled={approvingAll}>
            {approvingAll ? 'Aprobando…' : `Aprobar todo (${ads.filter((a) => a.approvalStatus === 'pending').length})`}
          </Btn>
        </div>
      )}

      {/* Storage usage bar */}
      {storage && (
        <div className="card mb-4 px-5 py-4">
          <div className="mb-2 flex justify-between text-xs">
            <span className="text-[var(--text-2)]"><b className="text-[var(--text)]">{storage.totalMB} MB</b> usados{storage.quotaMB ? ` de ${storage.quotaMB >= 1024 ? `${(storage.quotaMB / 1024).toFixed(1)} GB` : `${storage.quotaMB} MB`}` : ''}</span>
            <span className="text-[var(--muted)]">{storage.fileCount} archivos{storage.usedPct != null ? ` · ${storage.usedPct}%` : ''}</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-[var(--surface-2)]">
            <div className="h-1.5 rounded-full transition-all duration-700"
              style={{ width: `${Math.min(100, storage.usedPct ?? 0)}%`, background: (storage.usedPct ?? 0) > 90 ? 'var(--danger)' : (storage.usedPct ?? 0) > 70 ? 'var(--warn)' : 'var(--accent)' }} />
          </div>
          {(storage.usedPct ?? 0) > 90 && (
            <p className="mt-1.5 text-xs text-[var(--danger)]">Espacio casi agotado — borrá o pausá anuncios que ya no uses.</p>
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
        {canManage && !selected && filtered.length > 0 && (
          <div className="ml-auto">
            <Btn icon="trash" v="danger" onClick={() => setSelected(new Set())}>Eliminar varios</Btn>
          </div>
        )}
      </div>

      {selected && (
        <div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--danger-border)] bg-[var(--surface-2)] px-4 py-2.5 shadow-2xl">
          <span className="text-sm font-medium text-[var(--text)]">
            {selected.size === 0 ? 'Marcá los anuncios que querés eliminar' : `${selected.size} seleccionado${selected.size === 1 ? '' : 's'}`}
          </span>
          <button onClick={() => setSelected(new Set([...selected, ...paged.map((a) => a.id)]))}
            className="text-sm text-[var(--accent)] hover:underline">Marcar esta página ({paged.length})</button>
          {filtered.length > paged.length && (
            <button onClick={() => setSelected(new Set(filtered.map((a) => a.id)))}
              className="text-sm text-[var(--accent)] hover:underline">Marcar todos los filtrados ({filtered.length})</button>
          )}
          {selected.size > 0 && (
            <button onClick={() => setSelected(new Set())} className="text-sm text-[var(--accent)] hover:underline">Desmarcar</button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Btn size="sm" onClick={() => setSelected(null)}>Cancelar</Btn>
            <Btn size="sm" icon="trash" v="danger" onClick={() => setConfirmBulk(true)} disabled={selected.size === 0}>
              Eliminar {selected.size || ''}
            </Btn>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Cargando...</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-500">{search ? 'Sin resultados.' : `No hay anuncios en "${activeTabDef.label}".`}</p>
      ) : (
        <AdList ads={paged} h={handlers} selection={selected ? { selected, toggle: toggleSelected } : undefined} />
      )}

      {/* #8 — pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-[var(--muted)]">
          <span>{filtered.length} anuncios · página {page} de {totalPages}</span>
          <div className="flex gap-2">
            <Btn size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>‹ Anterior</Btn>
            <Btn size="sm" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>Siguiente ›</Btn>
          </div>
        </div>
      )}

      {viewAd && <AdViewer ad={viewAd} onClose={() => setViewAd(null)} />}

      {/* Aprobar todo — confirmación */}
      {confirmApproveAll && (
        <ConfirmDialog
          title="Aprobar todos los pendientes"
          message={`Se aprobarán ${ads.filter((a) => a.approvalStatus === 'pending').length} anuncios. Pasarán a estar activos.`}
          confirmLabel="Aprobar todo"
          onConfirm={handleApproveAll}
          onCancel={() => setConfirmApproveAll(false)}
        />
      )}

      {/* #9 — delete confirmation modal */}
      {confirmBulk && selected && (
        <ConfirmDialog
          title="Eliminar anuncios"
          message={`¿Eliminar ${selected.size} anuncio${selected.size === 1 ? '' : 's'}? Dejan de aparecer en las playlists y pasan al Archivo (se pueden restaurar desde ahí).`}
          confirmLabel={bulkDeleting ? 'Eliminando…' : `Eliminar ${selected.size}`}
          onConfirm={handleBulkDelete}
          onCancel={() => setConfirmBulk(false)}
        />
      )}

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">{editing ? 'Editar anuncio' : 'Subir anuncio'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="space-y-4">
              {/* File picker — solo al subir; el archivo no se reemplaza al editar */}
              {!editing && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Archivo(s) <span className="text-gray-400 font-normal">(mp4, jpg, png, webp · máx {MAX_SIZE_MB}MB · podés elegir varios)</span>
                </label>
                <div
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 transition-colors"
                >
                  {batch.length > 0 ? (
                    <p className="text-sm text-gray-700 font-medium">{batch.length} archivos seleccionados</p>
                  ) : file ? (
                    <p className="text-sm text-gray-700 font-medium">{file.name}</p>
                  ) : (
                    <p className="text-sm text-gray-400">Clic o arrastrá para seleccionar (uno o varios)</p>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept=".mp4,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length <= 1) { setBatch([]); handleFileChange(files[0] ?? null); }
                    else buildBatch(files);
                  }}
                />
                {fileError && <p className="text-red-500 text-xs mt-1">{fileError}</p>}
              </div>
              )}

              {/* Subida múltiple — lista de archivos con estado y duración por archivo */}
              {!editing && batch.length > 0 && (
                <div>
                  {!saving && (
                    <div className="flex items-center gap-2 mb-1.5 text-xs text-gray-500">
                      <span>Duración para todos:</span>
                      <input
                        type="number"
                        min="1"
                        className="input !py-0.5 !px-1.5 w-16 text-xs"
                        value={batchDurAll}
                        onChange={(e) => setBatchDurAll(e.target.value)}
                        onWheel={(e) => e.currentTarget.blur()}
                        placeholder="s"
                      />
                      <button
                        onClick={applyDurationToAll}
                        className="px-2 py-0.5 rounded border border-gray-200 hover:bg-gray-50 font-medium"
                      >Aplicar</button>
                    </div>
                  )}
                  <div className="space-y-1.5 max-h-56 overflow-y-auto border border-gray-100 rounded-lg p-2">
                    {batch.map((b, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="shrink-0">{b.type === 'video' ? '🎬' : '🖼️'}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-gray-700">{b.name}</p>
                          {b.status === 'uploading' && (
                            <div className="w-full bg-gray-100 rounded-full h-1 mt-0.5">
                              <div className="bg-blue-600 h-1 rounded-full transition-all duration-200" style={{ width: `${b.pct}%` }} />
                            </div>
                          )}
                          {b.error && <p className="text-red-500">{b.error}</p>}
                          {!b.invalid && b.videoLen != null && (
                            <p className={durTooShort(b) ? 'text-red-500 font-medium' : 'text-gray-400'}>
                              El video dura {b.videoLen.toFixed(1)}s
                              {durTooShort(b) && ' — la duración no puede ser menor'}
                            </p>
                          )}
                        </div>
                        {b.invalid ? (
                          <span className="shrink-0 tabular-nums text-gray-400">—</span>
                        ) : b.status === 'done' ? (
                          <span className="shrink-0 tabular-nums text-green-600">✓</span>
                        ) : b.status === 'uploading' ? (
                          <span className="shrink-0 tabular-nums text-gray-400">{b.pct}%</span>
                        ) : (
                          <span className="shrink-0 inline-flex items-center gap-0.5">
                            <input
                              type="number"
                              min="1"
                              className={`input !py-0.5 !px-1 w-14 text-xs text-right ${durTooShort(b) || !b.durationS ? 'border-red-400' : ''}`}
                              value={b.durationS || ''}
                              onChange={(e) => setBatchDuration(i, e.target.value)}
                              onWheel={(e) => e.currentTarget.blur()}
                            />
                            <span className="text-gray-400">s</span>
                          </span>
                        )}
                        {!saving && (
                          <button
                            onClick={() => setBatch((prev) => prev.filter((_, idx) => idx !== i))}
                            className="shrink-0 text-gray-300 hover:text-gray-600 text-sm leading-none"
                            title="Quitar"
                          >×</button>
                        )}
                      </div>
                    ))}
                  </div>
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

              {/* #3 — progress bar (subida simple) */}
              {!editing && batch.length === 0 && saving && (
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
                  {campaigns.filter(c => c.active || String(c.id) === form.campaignId).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.active ? '' : ' (inactiva)'}</option>
                  ))}
                </select>
              </div>
              {batch.length > 0 ? (
                <p className="text-xs text-gray-500">
                  Cada archivo se sube como un anuncio aparte. El nombre y el tipo salen del archivo; la duración
                  se detecta en los videos y podés ajustarla arriba. Comparten campaña, prioridad, URL destino y tags.
                </p>
              ) : (
              <>
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
                  {videoDuration != null && (
                    <p className={`text-xs mt-1 ${videoDuration > Number(form.durationS) + 0.5 ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                      El video dura {videoDuration.toFixed(1)}s
                      {videoDuration > Number(form.durationS) + 0.5 && ' — no se puede subir: es más largo que la duración configurada'}
                    </p>
                  )}
                </div>
              </div>
              </>
              )}
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
                <button
                  onClick={editing ? handleUpdate : (batch.length > 0 ? handleBatchUpload : handleUpload)}
                  disabled={saving || !!fileError || (batch.length > 0 && (batchDurError || batch.every((b) => b.invalid || b.status === 'done')))}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-2 rounded-lg text-sm font-medium"
                >
                  {editing
                    ? (saving ? 'Guardando...' : 'Guardar')
                    : batch.length > 0
                      ? (saving ? 'Subiendo...' : `Subir ${batch.filter((b) => !b.invalid && b.status !== 'done').length} anuncios`)
                      : (saving ? `Subiendo ${uploadPct}%` : 'Subir')}
                </button>
                <button onClick={() => setShowModal(false)} className="flex-1 border border-gray-200 hover:bg-gray-50 py-2 rounded-lg text-sm">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}

// Detalle de las pestañas de alerta, como tooltip: "Sin campaña" explica qué
// pasa; "Nunca pasaron" agrupa los anuncios por motivo.
function AlertTip({ tab, ads }: { tab: AdTabId; ads: Ad[] }) {
  const box = 'rounded-xl border p-3 text-sm shadow-lg';
  if (tab === 'nocampaign') {
    const n = ads.filter(hasNoCampaign).length;
    return (
      <div className={`${box} border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950`}>
        <p className="font-semibold text-red-800 dark:text-red-200">
          {n === 1 ? '1 anuncio no tiene campaña' : `${n} anuncios no tienen campaña`}
        </p>
        <p className="mt-1 text-red-700/90 dark:text-red-300/90">
          Su campaña fue archivada o eliminada, así que no se reproducen. Asignales una campaña (Editar) o eliminalos.
        </p>
      </div>
    );
  }
  const never = ads.filter(neverPlayed);
  const reasons = new Map<string, number>();
  for (const a of never) {
    const label = a.delivery?.issue?.label ?? 'Está en condiciones de pasar pero todavía no se reprodujo';
    reasons.set(label, (reasons.get(label) ?? 0) + 1);
  }
  return (
    <div className={`${box} border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950`}>
      <p className="font-semibold text-amber-800 dark:text-amber-200">
        {never.length === 1 ? '1 anuncio aprobado nunca se reprodujo' : `${never.length} anuncios aprobados nunca se reprodujeron`}
      </p>
      <ul className="mt-1 space-y-0.5 text-amber-800/90 dark:text-amber-300/90">
        {[...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => (
          <li key={label}>· {label}: <span className="font-semibold">{n}</span></li>
        ))}
      </ul>
    </div>
  );
}
