'use client';

import { useEffect, useState } from 'react';
import { api, ApiKey, BASE } from '@/lib/api';

const ENDPOINTS = [
  {
    method: 'GET',
    path: '/api/v1/public/stats',
    desc: 'Estadísticas generales del sistema',
    response: '{ totalPlays, tabletCount, activeCampaigns, activeClients, timestamp }',
  },
  {
    method: 'GET',
    path: '/api/v1/public/zones',
    desc: 'Tablets por zona geográfica',
    response: '[{ zone, tabletCount }]',
  },
  {
    method: 'GET',
    path: '/api/v1/public/campaigns',
    desc: 'Campañas activas (últimas 50)',
    response: '[{ id, name, startDate, endDate, active }]',
  },
];

export default function PublicApiPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = () => api.getApiKeys().then(setKeys).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!newKeyName.trim()) { setError('Ingresá un nombre para la API key'); return; }
    setCreating(true); setError(''); setCreatedKey(null);
    try {
      const k = await api.createApiKey(newKeyName.trim());
      setCreatedKey(k.key);
      setNewKeyName('');
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setCreating(false); }
  };

  const handleRevoke = async (id: number, name: string) => {
    if (!confirm(`¿Revocar la API key "${name}"?`)) return;
    await api.revokeApiKey(id);
    load();
  };

  const activeCount = keys.filter((k) => k.active).length;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">API pública</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Exponé datos de lectura a sistemas externos usando API keys. Toda petición requiere el header <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">X-API-Key: tu-clave</code>.</p>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'API keys totales', value: keys.length },
          { label: 'Activas', value: activeCount, color: 'text-emerald-600' },
          { label: 'Revocadas', value: keys.length - activeCount, color: 'text-gray-400' },
        ].map((k) => (
          <div key={k.label} className="card p-5">
            <p className={`text-3xl font-bold tabular-nums ${k.color ?? ''}`}>{k.value}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{k.label}</p>
          </div>
        ))}
      </div>

      {/* Create new key */}
      <div className="card p-5 mb-6">
        <h2 className="font-semibold mb-3">Crear nueva API key</h2>
        <div className="flex gap-3">
          <input
            className="input flex-1"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            placeholder="Nombre descriptivo (ej: App tercero, Sistema CRM...)"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newKeyName.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            {creating ? 'Generando...' : 'Generar key'}
          </button>
        </div>
        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}

        {createdKey && (
          <div className="mt-3 p-4 rounded-xl border-2 border-emerald-400 bg-emerald-50 dark:bg-emerald-950/20">
            <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 mb-1">API key creada — copiala ahora, no se mostrará de nuevo:</p>
            <code className="font-mono text-sm font-bold break-all">{createdKey}</code>
            <button
              onClick={() => { navigator.clipboard?.writeText(createdKey); }}
              className="ml-3 text-xs text-emerald-700 dark:text-emerald-400 underline"
            >
              Copiar
            </button>
          </div>
        )}
      </div>

      {/* Keys table */}
      {loading ? (
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
      ) : keys.length > 0 ? (
        <div className="card overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide border-b" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-md)' }}>
                <th className="text-left px-4 py-3">Nombre</th>
                <th className="text-left px-4 py-3">Key (parcial)</th>
                <th className="text-right px-4 py-3">Estado</th>
                <th className="text-right px-4 py-3">Último uso</th>
                <th className="text-right px-4 py-3">Creada</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-4 py-2.5 font-medium">{k.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{k.key}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${k.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-gray-100 text-gray-400 dark:bg-gray-800'}`}>
                      {k.active ? 'Activa' : 'Revocada'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                    {k.lastUsed ? new Date(k.lastUsed).toLocaleDateString('es-AR') : 'Nunca'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                    {new Date(k.createdAt).toLocaleDateString('es-AR')}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {k.active && (
                      <button onClick={() => handleRevoke(k.id, k.name)} className="text-xs text-red-500 hover:underline">Revocar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card p-6 text-center mb-6">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No hay API keys. Creá una para empezar.</p>
        </div>
      )}

      {/* Endpoint docs */}
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Endpoints disponibles</h2>
          <a
            href={`${BASE}/api/docs`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-blue-500 hover:underline"
          >
            Ver Swagger completo →
          </a>
        </div>
        <div className="space-y-4">
          {ENDPOINTS.map((ep) => (
            <div key={ep.path} className="rounded-xl border p-4" style={{ borderColor: 'var(--border-md)', background: 'var(--bg)' }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-0.5 rounded font-mono">{ep.method}</span>
                <code className="text-sm font-mono font-medium">{ep.path}</code>
              </div>
              <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>{ep.desc}</p>
              <div className="rounded-lg p-2 text-xs font-mono" style={{ background: 'var(--border)', color: 'var(--text-muted)' }}>
                {ep.response}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Example usage */}
      <div className="card p-5">
        <h2 className="font-semibold mb-3">Ejemplo de uso</h2>
        <div className="rounded-xl p-4 text-xs font-mono space-y-1" style={{ background: 'var(--bg)', border: '1px solid var(--border-md)' }}>
          <p style={{ color: 'var(--text-muted)' }}># Con curl:</p>
          <p>{'curl -H "X-API-Key: ICADS-TU_CLAVE" \\'}</p>
          <p>&nbsp;&nbsp;{`${BASE}/api/v1/public/stats`}</p>
          <p className="pt-2" style={{ color: 'var(--text-muted)' }}># Con JavaScript:</p>
          <p>{'fetch("' + BASE + '/api/v1/public/stats", {'}</p>
          <p>&nbsp;&nbsp;{'headers: { "X-API-Key": "ICADS-TU_CLAVE" }'}</p>
          <p>{'}).then(r => r.json()).then(console.log)'}</p>
        </div>
      </div>
    </div>
  );
}
