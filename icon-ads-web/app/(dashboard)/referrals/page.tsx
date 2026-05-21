'use client';

import { useEffect, useState } from 'react';
import { api, Referral, Client } from '@/lib/api';

export default function ReferralsPage() {
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState('');
  const [creating, setCreating] = useState(false);

  const load = () =>
    Promise.all([api.getReferrals(), api.getClients()])
      .then(([r, c]) => { setReferrals(r); setClients(c); })
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!selectedClient) return;
    setCreating(true);
    try { await api.createReferral(Number(selectedClient)); setSelectedClient(''); load(); }
    finally { setCreating(false); }
  };

  const activeCount = referrals.filter((r) => !r.used).length;
  const usedCount = referrals.filter((r) => r.used).length;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Sistema de referidos</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Generá códigos únicos para que clientes traigan nuevos clientes.</p>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total códigos', value: referrals.length },
          { label: 'Activos', value: activeCount, color: 'text-emerald-600' },
          { label: 'Canjeados', value: usedCount, color: 'text-blue-600' },
        ].map((k) => (
          <div key={k.label} className="card p-5">
            <p className={`text-3xl font-bold tabular-nums ${k.color ?? ''}`}>{k.value}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{k.label}</p>
          </div>
        ))}
      </div>

      {/* Create new referral code */}
      <div className="card p-5 mb-6">
        <h2 className="font-semibold mb-3">Generar código de referido</h2>
        <div className="flex gap-3">
          <select
            className="input flex-1"
            value={selectedClient}
            onChange={(e) => setSelectedClient(e.target.value)}
          >
            <option value="">Seleccionar cliente...</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ''}</option>
            ))}
          </select>
          <button
            onClick={handleCreate}
            disabled={creating || !selectedClient}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            {creating ? 'Generando...' : 'Generar código'}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
      ) : referrals.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No hay códigos de referido.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide border-b" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-md)' }}>
                <th className="text-left px-4 py-3">Código</th>
                <th className="text-left px-4 py-3">Referente</th>
                <th className="text-left px-4 py-3">Referido</th>
                <th className="text-right px-4 py-3">Estado</th>
                <th className="text-right px-4 py-3">Creado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {referrals.map((r) => (
                <tr key={r.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-4 py-2.5 font-mono font-bold text-xs">{r.code}</td>
                  <td className="px-4 py-2.5 font-medium">{r.referrer.name}</td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>{r.referred?.name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.used ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'}`}>
                      {r.used ? 'Canjeado' : 'Activo'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                    {new Date(r.createdAt).toLocaleDateString('es-AR')}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {!r.used && (
                      <button onClick={async () => { await api.deleteReferral(r.id); load(); }} className="text-xs text-red-500 hover:underline">Eliminar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
