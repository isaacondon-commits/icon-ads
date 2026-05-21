'use client';

import { useEffect, useState } from 'react';
import { api, HealthCheck, LatencySummary } from '@/lib/api';

export default function ApiControlPage() {
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [latency, setLatency] = useState<LatencySummary | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshed, setRefreshed] = useState<Date | null>(null);

  const load = () => {
    setLoading(true);
    Promise.allSettled([
      api.getHealth(),
      api.getLatency(),
      api.getSettings(),
    ]).then(([h, l, s]) => {
      if (h.status === 'fulfilled') setHealth(h.value);
      if (l.status === 'fulfilled') setLatency(l.value);
      if (s.status === 'fulfilled') setSettings(s.value);
      setRefreshed(new Date());
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const dbOk = health?.db === 'ok';
  const r2Ok = health?.r2 === true;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold">Panel de API</h1>
        <button
          onClick={load}
          disabled={loading}
          className="text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          {loading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        Estado del sistema, latencia y configuración del servidor.
        {refreshed && <span className="ml-2">Última actualización: {refreshed.toLocaleTimeString('es-AR')}</span>}
      </p>

      {/* Health */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          {
            label: 'API status',
            value: health?.status ?? '—',
            color: health?.status === 'ok' ? 'text-emerald-600' : 'text-red-500',
          },
          {
            label: 'Base de datos',
            value: dbOk ? 'Conectada' : (health?.db ?? '—'),
            color: dbOk ? 'text-emerald-600' : 'text-red-500',
          },
          {
            label: 'Almacenamiento R2',
            value: r2Ok ? 'Configurado' : 'No configurado',
            color: r2Ok ? 'text-emerald-600' : 'text-amber-500',
          },
          {
            label: 'Uptime',
            value: health ? formatUptime(health.uptime) : '—',
            color: '',
          },
        ].map((k) => (
          <div key={k.label} className="card p-5">
            <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
            <p className="text-xs font-medium mt-1" style={{ color: 'var(--text-muted)' }}>{k.label}</p>
          </div>
        ))}
      </div>

      {/* Env vars */}
      {health && (
        <div className="card p-6 mb-6">
          <h2 className="font-semibold mb-4">Variables de entorno</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.entries(health.env).map(([key, val]) => (
              <div key={key} className="flex items-center gap-3 text-sm py-1.5 border-b" style={{ borderColor: 'var(--border)' }}>
                <span className="font-mono text-xs w-48 shrink-0" style={{ color: 'var(--text-muted)' }}>{key}</span>
                <span className={`text-xs font-medium ${val === 'set' ? 'text-emerald-600' : val.startsWith('UNSET') ? 'text-red-500' : ''}`}>{val}</span>
              </div>
            ))}
          </div>
          {health.dbError && (
            <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-xs text-red-600 font-mono">
              DB Error: {health.dbError}
            </div>
          )}
        </div>
      )}

      {/* Latency */}
      {latency && (
        <div className="card p-6 mb-6">
          <h2 className="font-semibold mb-4">Latencia de endpoints</h2>
          <div className="grid grid-cols-3 gap-4 mb-5">
            {[
              { label: 'Requests registrados', value: latency.count.toLocaleString() },
              { label: 'Promedio', value: `${latency.avg}ms`, color: latency.avg > 1000 ? 'text-red-500' : latency.avg > 300 ? 'text-amber-500' : 'text-emerald-600' },
              { label: 'P95', value: `${latency.p95}ms`, color: latency.p95 > 2000 ? 'text-red-500' : latency.p95 > 500 ? 'text-amber-500' : 'text-emerald-600' },
            ].map((k) => (
              <div key={k.label}>
                <p className={`text-2xl font-bold tabular-nums ${k.color ?? ''}`}>{k.value}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{k.label}</p>
              </div>
            ))}
          </div>

          {latency.slow.length > 0 && (
            <>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>REQUESTS LENTOS (&gt;1s)</p>
              <table className="w-full text-xs mb-4">
                <thead>
                  <tr style={{ color: 'var(--text-muted)' }}>
                    <th className="text-left pb-1">Método</th>
                    <th className="text-left pb-1">Ruta</th>
                    <th className="text-right pb-1">ms</th>
                    <th className="text-right pb-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {latency.slow.map((r, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="py-1 font-mono">{r.method}</td>
                      <td className="py-1 font-mono truncate max-w-[200px]">{r.path}</td>
                      <td className="py-1 text-right tabular-nums text-red-500 font-medium">{r.ms}</td>
                      <td className="py-1 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>REQUESTS RECIENTES</p>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ color: 'var(--text-muted)' }}>
                <th className="text-left pb-1">Método</th>
                <th className="text-left pb-1">Ruta</th>
                <th className="text-right pb-1">ms</th>
                <th className="text-right pb-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {latency.recent.map((r, i) => (
                <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="py-1 font-mono">{r.method}</td>
                  <td className="py-1 font-mono truncate max-w-[200px]">{r.path}</td>
                  <td className={`py-1 text-right tabular-nums font-medium ${r.ms > 1000 ? 'text-red-500' : r.ms > 300 ? 'text-amber-500' : ''}`}>{r.ms}</td>
                  <td className={`py-1 text-right tabular-nums ${r.status >= 400 ? 'text-red-500' : ''}`}>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* System settings */}
      {Object.keys(settings).length > 0 && (
        <div className="card p-6 mb-6">
          <h2 className="font-semibold mb-4">Configuración activa del sistema</h2>
          <div className="space-y-1">
            {Object.entries(settings).map(([key, val]) => (
              <div key={key} className="flex items-center gap-3 text-sm py-1.5 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                <span className="font-mono text-xs w-56 shrink-0" style={{ color: 'var(--text-muted)' }}>{key}</span>
                <span className="font-medium truncate">{val}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Export actions */}
      <div className="card p-6">
        <h2 className="font-semibold mb-4">Exportaciones</h2>
        <div className="flex flex-wrap gap-3">
          <a href={api.getBackupUrl()} className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors">
            Backup JSON
          </a>
          <a href={api.getExcelUrl()} className="text-sm bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium transition-colors">
            Exportar Excel (.xlsx)
          </a>
          <a href={api.getTabletsCsvUrl()} className="text-sm bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg font-medium transition-colors">
            Tablets CSV
          </a>
          <a href={api.getAuditCsvUrl()} className="text-sm bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg font-medium transition-colors">
            Auditoría CSV
          </a>
        </div>
      </div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}
