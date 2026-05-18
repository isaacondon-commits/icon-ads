'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, TabletDetail } from '@/lib/api';

export default function TabletDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tablet, setTablet] = useState<TabletDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getTablet(Number(id))
      .then(setTablet)
      .catch(() => router.push('/tablets'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Cargando...</p>;
  if (!tablet) return null;

  const now = Date.now();
  const lastSyncMs = tablet.lastSync ? new Date(tablet.lastSync).getTime() : 0;
  const offlineMin = lastSyncMs ? Math.floor((now - lastSyncMs) / 60000) : null;
  const isOnline = offlineMin !== null && offlineMin < 70;

  return (
    <div>
      <button onClick={() => router.back()} className="text-sm mb-4 hover:underline flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
        ← Volver
      </button>

      {/* Header card */}
      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className={`w-3 h-3 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-gray-400'}`} />
              <h1 className="text-2xl font-bold">{tablet.name}</h1>
            </div>
            <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{tablet.deviceId}</p>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
            {isOnline ? 'online' : 'offline'}
          </span>
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-5 border-t" style={{ borderColor: 'var(--border-md)' }}>
          {[
            { label: 'Zona', value: tablet.zone || '—' },
            { label: 'Timezone', value: tablet.timezone || '—' },
            { label: 'Playlist', value: tablet.playlist?.name || '—' },
            { label: 'Versión', value: tablet.playlist ? `v${tablet.playlist.version}` : '—' },
          ].map((s) => (
            <div key={s.label}>
              <p className="text-xs mb-0.5" style={{ color: 'var(--text-xs)' }}>{s.label}</p>
              <p className="font-medium text-sm">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-md)' }}>
          {[
            { label: 'Reproducciones hoy', value: tablet.playsToday },
            { label: 'Total histórico', value: tablet.playsAllTime.toLocaleString() },
            { label: 'Última sincronía', value: tablet.lastSync ? new Date(tablet.lastSync).toLocaleString('es-AR') : 'Nunca' },
          ].map((s) => (
            <div key={s.label}>
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* #29 — Error logs / sync history */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b font-semibold" style={{ borderColor: 'var(--border-md)' }}>
          Historial de errores ({tablet.errorLogs.length})
        </div>
        {tablet.errorLogs.length === 0 ? (
          <p className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>Sin errores registrados.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ background: 'var(--bg)', borderColor: 'var(--border-md)' }}>
                <th className="text-left px-5 py-2 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Tipo</th>
                <th className="text-left px-5 py-2 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Mensaje</th>
                <th className="text-left px-5 py-2 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {tablet.errorLogs.map((e) => (
                <tr key={e.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-5 py-2.5">
                    <span className="text-xs bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 px-2 py-0.5 rounded font-mono">{e.errorType}</span>
                  </td>
                  <td className="px-5 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{e.message}</td>
                  <td className="px-5 py-2.5 text-xs" style={{ color: 'var(--text-xs)' }}>
                    {new Date(e.occurredAt).toLocaleString('es-AR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
