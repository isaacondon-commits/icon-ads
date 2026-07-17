'use client';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'https://icon-ads-backend.onrender.com';

type Health = {
  status: string;
  db: string;
  dbError?: string;
  supabase_storage: boolean;
  uptime: number;
  timestamp: string;
  version: string;
};

function dot(ok: boolean) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`}
    />
  );
}

function formatUptime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function StatusPage() {
  const [data, setData] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  async function check() {
    try {
      const res = await fetch(`${API}/api/health`, { cache: 'no-store' });
      const json: Health = await res.json();
      setData(json);
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      setLastCheck(new Date());
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch + polling on mount, not a compiler target
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, []);

  const allOk = !offline && data?.status === 'ok' && data?.db === 'ok' && data?.supabase_storage;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
            <span className="text-white font-bold text-sm">IA</span>
          </div>
          <div>
            <h1 className="font-semibold text-gray-900 leading-tight">ICON ADS</h1>
            <p className="text-xs text-gray-500">Estado del sistema</p>
          </div>
        </div>

        {/* Overall status */}
        <div
          className={`rounded-lg px-4 py-3 mb-6 text-sm font-medium ${
            offline
              ? 'bg-red-50 text-red-700'
              : allOk
              ? 'bg-green-50 text-green-700'
              : 'bg-yellow-50 text-yellow-700'
          }`}
        >
          {offline
            ? 'Backend no disponible'
            : allOk
            ? 'Todos los sistemas operacionales'
            : 'Sistema degradado'}
        </div>

        {/* Service rows */}
        <div className="space-y-3 mb-6">
          {[
            { label: 'Backend API', ok: !offline },
            { label: 'Base de datos', ok: !offline && data?.db === 'ok' },
            { label: 'Supabase Storage', ok: !offline && !!data?.supabase_storage },
          ].map(({ label, ok }) => (
            <div key={label} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
              <span className="text-sm text-gray-700 flex items-center gap-2">
                {dot(ok)} {label}
              </span>
              <span className={`text-xs font-medium ${ok ? 'text-green-600' : 'text-red-600'}`}>
                {ok ? 'Operacional' : 'Error'}
              </span>
            </div>
          ))}
        </div>

        {/* Metadata */}
        {data && (
          <div className="space-y-1 text-xs text-gray-500">
            <div className="flex justify-between">
              <span>Uptime</span>
              <span className="font-medium text-gray-700">{formatUptime(data.uptime)}</span>
            </div>
            <div className="flex justify-between">
              <span>Versión</span>
              <span className="font-medium text-gray-700">v{data.version}</span>
            </div>
          </div>
        )}

        <p className="mt-4 text-center text-xs text-gray-400">
          Actualizado{' '}
          {lastCheck ? lastCheck.toLocaleTimeString('es-UY') : '—'}
          {' · '}auto-refresca c/30s
        </p>
      </div>
    </div>
  );
}
