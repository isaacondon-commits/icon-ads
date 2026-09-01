'use client';

import { useCallback, useRef, useState } from 'react';
import { api } from '@/lib/api';

// Botón "Ver pantalla" + modal: pide una captura a la tablet, espera a que
// llegue, y la muestra. On-demand — no es un stream.
export default function ScreenshotViewer({ tabletId, tabletName }: { tabletId: number; tabletName: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'waiting' | 'done' | 'error'>('idle');
  const [img, setImg] = useState<string | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  const downloadImage = (dataUri: string, when: string | null) => {
    const d = when ? new Date(when) : new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    const safeName = tabletName.replace(/[\\/:*?"<>|]/g, '').trim();
    const a = document.createElement('a');
    a.href = dataUri;
    a.download = `${safeName} - ${stamp}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const capture = useCallback(async () => {
    stop();
    setStatus('waiting');
    setImg(null);
    const startedAt = Date.now();
    try {
      await api.requestScreenshot(tabletId);
    } catch {
      setStatus('error');
      return;
    }
    // Polls la última captura; acepta sólo una tomada DESPUÉS de pedirla.
    let tries = 0;
    pollRef.current = setInterval(async () => {
      tries++;
      try {
        const r = await api.getScreenshot(tabletId);
        if (r.image && r.at && new Date(r.at).getTime() >= startedAt - 3000) {
          stop();
          setImg(r.image);
          setAt(r.at);
          setStatus('done');
          downloadImage(r.image, r.at); // descarga automática con nombre + hora
        }
      } catch { /* keep polling */ }
      if (tries > 25) { stop(); setStatus(img ? 'done' : 'error'); }
    }, 2000);
  }, [tabletId, img]);

  const openAndCapture = () => { setOpen(true); capture(); };
  const close = () => { stop(); setOpen(false); setStatus('idle'); };

  return (
    <>
      <button
        onClick={openAndCapture}
        className="text-xs px-2.5 py-1 rounded-lg border font-medium hover:bg-blue-50 dark:hover:bg-blue-950 text-blue-600 border-blue-200"
        title="Capturar lo que muestra la tablet ahora"
      >
        Ver pantalla
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={close}>
          <div className="rounded-xl shadow-2xl max-w-2xl w-full p-5" style={{ background: 'var(--card)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-sm">Pantalla de {tabletName}</h2>
              <div className="flex items-center gap-2">
                <button onClick={capture} disabled={status === 'waiting'} className="text-xs px-2.5 py-1 rounded-lg border disabled:opacity-50" style={{ borderColor: 'var(--border-md)' }}>
                  {status === 'waiting' ? 'Capturando...' : 'Actualizar'}
                </button>
                <button onClick={close} className="text-xl leading-none px-1" style={{ color: 'var(--text-muted)' }}>×</button>
              </div>
            </div>

            {status === 'waiting' && !img && (
              <div className="aspect-video flex flex-col items-center justify-center rounded-lg text-sm gap-1" style={{ background: 'var(--bg)', color: 'var(--text-muted)' }}>
                <span className="inline-block animate-spin text-lg">↻</span>
                Esperando la captura de la tablet… (puede tardar ~15-30 s)
              </div>
            )}
            {status === 'error' && !img && (
              <div className="aspect-video flex items-center justify-center rounded-lg text-sm text-red-500" style={{ background: 'var(--bg)' }}>
                No se pudo obtener la captura. La tablet puede estar offline o la pantalla apagada.
              </div>
            )}
            {img && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img} alt={`Pantalla de ${tabletName}`} className="w-full rounded-lg border" style={{ borderColor: 'var(--border-md)' }} />
                <div className="flex items-center justify-between mt-2">
                  {at && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Tomada {new Date(at).toLocaleString('es-UY')} · se descargó automáticamente</p>}
                  <button onClick={() => img && downloadImage(img, at)} className="text-xs px-2.5 py-1 rounded-lg border" style={{ borderColor: 'var(--border-md)' }}>
                    Descargar de nuevo
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
