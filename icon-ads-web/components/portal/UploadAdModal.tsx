'use client';

import { useEffect, useState, FormEvent } from 'react';
import { portal, PortalUpload, UPLOAD_LIMITS } from '@/lib/portal';
import { FormError } from '@/components/portal/AuthCard';

const ACCEPT = 'video/mp4,image/jpeg,image/png,image/webp';

// Duración real de un video, leída por el navegador (null si no puede).
function videoDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => resolve(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => resolve(null);
    v.src = url;
  });
}

export default function UploadAdModal({ maxSeconds, onClose, onUploaded }: { maxSeconds: number; onClose: () => void; onUploaded: (u: PortalUpload) => void }) {
  // Tiempos de imagen que permite su tope (más el tope mismo si no está en la lista).
  const imageChoices = [...new Set([...UPLOAD_LIMITS.imageDurations.filter((s) => s <= maxSeconds), Math.min(maxSeconds, 30)])].sort((a, b) => a - b);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [videoS, setVideoS] = useState<number | null>(null);
  const [imageS, setImageS] = useState(Math.min(10, maxSeconds));
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const isVideo = file?.type === 'video/mp4' || /\.mp4$/i.test(file?.name ?? '');
  const uploading = progress !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !uploading) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, uploading]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = async (f: File | null) => {
    setError(''); setVideoS(null); setFile(null); setPreview('');
    if (!f) return;
    const video = f.type === 'video/mp4' || /\.mp4$/i.test(f.name);
    if (!video && !/^image\/(jpeg|png|webp)$/.test(f.type)) { setError('Formato no permitido. Usá MP4, JPG, PNG o WEBP.'); return; }
    const maxMb = video ? UPLOAD_LIMITS.videoMb : UPLOAD_LIMITS.imageMb;
    if (f.size > maxMb * 1024 * 1024) { setError(`El archivo pesa ${(f.size / 1048576).toFixed(0)} MB. El máximo es ${maxMb} MB.`); return; }
    const url = URL.createObjectURL(f);
    if (video) {
      const d = await videoDuration(url);
      if (d !== null && Math.ceil(d - 0.05) > maxSeconds) {
        URL.revokeObjectURL(url);
        setError(`El video dura ${Math.ceil(d - 0.05)} s. Tu máximo es ${maxSeconds} s.`);
        return;
      }
      setVideoS(d);
    }
    if (!name.trim()) setName(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 120));
    setFile(f); setPreview(url);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) { setError('Elegí un archivo.'); return; }
    if (!name.trim()) { setError('Poné un nombre para el anuncio.'); return; }
    setError(''); setProgress(0);
    try {
      // Video: el backend la lee del archivo; la del navegador es el respaldo (0 = no se sabe).
      const durationS = isVideo ? (videoS !== null ? Math.max(1, Math.ceil(videoS - 0.05)) : 0) : imageS;
      const created = await portal.uploadAd(file, { publicName: name.trim(), durationS }, setProgress);
      onUploaded(created);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir.');
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="up-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 id="up-title" className="text-lg font-semibold">Subir un anuncio</h2>
          <button type="button" onClick={onClose} disabled={uploading} aria-label="Cerrar" className="flex h-8 w-8 items-center justify-center rounded-full text-xl text-[var(--muted)] hover:bg-[var(--surface-hover)] disabled:opacity-40">×</button>
        </div>

        {done ? (
          <>
            <p className="text-sm text-[var(--text-2)]">
              Listo, recibimos <strong>{name.trim()}</strong>. Queda <strong>en revisión</strong>: cuando lo aprobemos empieza a pasar en los taxis y lo vas a ver en tus estadísticas.
            </p>
            <button type="button" onClick={onClose} className="mt-5 h-10 w-full rounded-full bg-[var(--accent-strong)] text-sm font-medium text-white">Cerrar</button>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="up-file" className="mb-1 block text-xs text-[var(--muted)]">Archivo</label>
              <input id="up-file" type="file" accept={ACCEPT} disabled={uploading}
                onChange={(e) => pick(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-[var(--text-2)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--surface-2)] file:px-4 file:py-2 file:text-sm file:text-[var(--text)]" />
              <p className="mt-1 text-xs text-[var(--muted)]">
                Video MP4 (hasta {UPLOAD_LIMITS.videoMb} MB y {maxSeconds} s) o imagen JPG, PNG o WEBP (hasta {UPLOAD_LIMITS.imageMb} MB). Ideal: horizontal, 1920×1080.
              </p>
            </div>

            {file && preview && (
              <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-black">
                {isVideo
                  ? <video src={preview} controls muted playsInline className="aspect-video w-full object-contain" />
                  : <img src={preview} alt="Vista previa" className="aspect-video w-full object-contain" />}
              </div>
            )}

            <div>
              <label htmlFor="up-name" className="mb-1 block text-xs text-[var(--muted)]">Nombre del anuncio</label>
              <input id="up-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} disabled={uploading}
                placeholder="Ej.: Promo de verano" className="input h-11" required />
              <p className="mt-1 text-xs text-[var(--muted)]">Así lo vas a ver en tus estadísticas.</p>
            </div>

            {file && !isVideo && (
              <div>
                <label htmlFor="up-dur" className="mb-1 block text-xs text-[var(--muted)]">Tiempo en pantalla</label>
                <select id="up-dur" value={imageS} onChange={(e) => setImageS(Number(e.target.value))} disabled={uploading} className="input h-11">
                  {imageChoices.map((s) => <option key={s} value={s}>{s} segundos</option>)}
                </select>
              </div>
            )}
            {file && isVideo && videoS !== null && (
              <p className="text-xs text-[var(--muted)]">Duración del video: {Math.round(videoS)} s</p>
            )}

            <FormError message={error} />

            {uploading && (
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                  <div className="h-full bg-[var(--accent-strong)] transition-[width]" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-1 text-center text-xs text-[var(--muted)]">{progress! < 100 ? `Subiendo… ${progress}%` : 'Procesando…'}</p>
              </div>
            )}

            <button type="submit" disabled={uploading || !file} className="h-11 w-full rounded-full bg-[var(--accent-strong)] font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50">
              {uploading ? 'Subiendo…' : 'Enviar para revisión'}
            </button>
            <p className="text-center text-xs text-[var(--muted)]">Lo revisamos antes de que salga en los taxis.</p>
          </form>
        )}
      </div>
    </div>
  );
}
