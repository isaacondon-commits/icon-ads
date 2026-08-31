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

  const [file, setFile] = useState<File | null>(null);
  const [versionCode, setVersionCode] = useState('');
  const [versionName, setVersionName] = useState('');
  const [uploading, setUploading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.getApkStatus()
      .then(setStatus)
      .catch((e) => show(e instanceof Error ? e.message : 'Error al cargar', 'error'))
      .finally(() => setLoading(false));
  }, [show]);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async () => {
    if (!file) { show('Seleccioná el archivo .apk', 'error'); return; }
    const code = Number(versionCode);
    if (!Number.isInteger(code) || code < 1) { show('versionCode inválido', 'error'); return; }
    if (!versionName.trim()) { show('Falta el versionName', 'error'); return; }
    setUploading(true);
    try {
      const res = await api.uploadApk(file, code, versionName.trim());
      show(`APK v${res.versionCode} publicada — las tablets la bajan solas en el próximo sync`);
      setFile(null); setVersionCode(''); setVersionName('');
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error al subir el APK', 'error');
    } finally { setUploading(false); }
  };

  const pub = status?.published;
  const behind = status ? status.totalTablets - status.upToDate : 0;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">APK Android</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          La versión publicada acá es la que todas las tablets descargan e instalan solas.
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

      {/* Subir nueva */}
      <div className="card p-6">
        <h2 className="font-semibold mb-1">Publicar una versión nueva</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          El <code>versionCode</code> y <code>versionName</code> tienen que coincidir con los de{' '}
          <code>app/build.gradle.kts</code> al compilar. La APK tiene que estar firmada con la misma
          clave que la que ya está en las tablets, o el sistema la rechaza.
        </p>
        <div className="space-y-3">
          <input type="file" accept=".apk" className="input"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <div className="flex flex-wrap gap-3">
            <input type="number" min="1" className="input w-40" placeholder="versionCode"
              value={versionCode} onChange={(e) => setVersionCode(e.target.value)}
              onWheel={(e) => e.currentTarget.blur()} />
            <input type="text" className="input flex-1 min-w-[160px]" placeholder="versionName (ej: 1.10)"
              value={versionName} onChange={(e) => setVersionName(e.target.value)} />
            <button onClick={handleUpload} disabled={uploading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium whitespace-nowrap">
              {uploading ? 'Subiendo...' : 'Publicar APK'}
            </button>
          </div>
        </div>
      </div>

      {/* Despliegue en la flota */}
      <div className="card p-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-semibold">Despliegue en la flota</h2>
          <button onClick={load} className="text-xs text-blue-600 hover:underline">actualizar</button>
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

      {/* Cómo funciona */}
      <div className="card p-6 text-sm space-y-2" style={{ color: 'var(--text-muted)' }}>
        <h2 className="font-semibold" style={{ color: 'var(--text-strong, inherit)' }}>Cómo funciona</h2>
        <p>1. Cada tablet se instala <b>una sola vez por USB</b> (la primera de todas).</p>
        <p>2. Cada ~1 h la tablet consulta la versión publicada acá. Si hay una mayor, la baja por WiFi
          y la instala con <code>PackageInstaller</code>.</p>
        <p>3. Con la app <b>Device Owner</b>: instalación 100% silenciosa, sin ningún toque. Sin Device
          Owner: puede pedir confirmar una vez (la primera actualización OTA), después silenciosa.</p>
        <p>4. Nunca desinstalar una tablet: cambia su <code>ANDROID_ID</code> y aparece como tablet nueva.</p>
      </div>
    </div>
  );
}
