'use client';

import { useEffect, useState, useCallback } from 'react';
import { api, ApkStatus } from '@/lib/api';
import { useToast } from '@/lib/toast-context';

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

export default function ApkPage() {
  const { show } = useToast();
  const [status, setStatus] = useState<ApkStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [forcing, setForcing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.getApkStatus()
      .then(setStatus)
      .catch((e) => show(e instanceof Error ? e.message : 'Error al cargar', 'error'))
      .finally(() => setLoading(false));
  }, [show]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos, no un target del compilador
  useEffect(() => { load(); }, [load]);

  const handleForce = async () => {
    setForcing(true);
    try {
      const res = await api.forceUpdateApkAll();
      show(res.message);
      setTimeout(load, 3000);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error al forzar', 'error');
    } finally { setForcing(false); }
  };

  const pub = status?.published;
  const behind = status ? status.totalTablets - status.upToDate : 0;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">APK Android</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Versión publicada y estado del despliegue en la flota.
        </p>
      </div>

      {/* Versión publicada */}
      <div className="card p-6">
        <h2 className="font-semibold mb-3">Versión publicada</h2>
        {loading ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
        ) : pub?.versionName ? (
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-3xl font-bold">v{pub.versionName}</span>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>código {pub.versionCode}</span>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>subida {timeAgo(pub.uploadedAt)}</span>
            {pub.url && (
              <a href={pub.url} className="text-sm text-blue-600 hover:underline" target="_blank" rel="noreferrer">
                descargar .apk
              </a>
            )}
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Todavía no se publicó ninguna APK.</p>
        )}
      </div>

      {/* Despliegue en la flota */}
      <div className="card p-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-semibold">Despliegue en la flota</h2>
          <div className="flex items-center gap-3">
            <button onClick={handleForce} disabled={forcing || !pub?.versionName}
              className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-medium">
              {forcing ? 'Empujando...' : 'Forzar actualización en toda la flota'}
            </button>
            <button onClick={load} className="text-xs text-blue-600 hover:underline">actualizar</button>
          </div>
        </div>
        {status && (
          <>
            <div className="flex gap-6 mb-4 text-sm">
              <span><b className="text-2xl font-bold">{status.upToDate}</b> / {status.totalTablets} al día</span>
              {behind > 0 && <span className="text-amber-500 self-end">{behind} atrasadas</span>}
            </div>
            <div className="space-y-2">
              {status.versions.map((v) => (
                <div key={v.version} className="rounded-lg border p-3" style={{ borderColor: 'var(--border-md)' }}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${v.upToDate ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                    <span className="font-medium text-sm">
                      {v.version === 'desconocida' ? 'Versión desconocida' : `v${v.version}`}
                    </span>
                    {v.upToDate && <span className="text-xs text-emerald-600">(publicada)</span>}
                    <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>
                      {v.count} tablet{v.count !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {v.tablets.map((t) => t.name).join(' · ')}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
