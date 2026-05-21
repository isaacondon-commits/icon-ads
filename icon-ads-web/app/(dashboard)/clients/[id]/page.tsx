'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, ClientProfile } from '@/lib/api';

const CHART_COLORS = ['#3b82f6','#8b5cf6','#f59e0b','#10b981','#ef4444','#06b6d4'];

export default function ClientProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getClientProfile(Number(id))
      .then(setProfile)
      .catch(() => router.push('/clients'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Cargando perfil...</p>;
  if (!profile) return null;

  const totalPlays = profile.campaigns.reduce((s, c) => s + c.stats.plays, 0);
  const totalSeconds = profile.campaigns.reduce((s, c) => s + c.stats.totalSeconds, 0);
  const activeCampaigns = profile.campaigns.filter((c) => c.active).length;
  const maxPlays = Math.max(...profile.campaigns.map((c) => c.stats.plays), 1);

  return (
    <div>
      <button
        onClick={() => router.back()}
        className="text-sm mb-4 hover:underline flex items-center gap-1"
        style={{ color: 'var(--text-muted)' }}
      >
        ← Volver
      </button>

      {/* Header */}
      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{profile.name}</h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{profile.email}</p>
            {profile.company && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{profile.company}</p>}
          </div>
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${profile.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
            {profile.active ? 'Activo' : 'Inactivo'}
          </span>
        </div>
        {/* Summary row */}
        <div className="grid grid-cols-3 gap-4 mt-5 pt-5 border-t" style={{ borderColor: 'var(--border-md)' }}>
          {[
            { label: 'Campañas activas', value: activeCampaigns },
            { label: 'Total reproducciones', value: totalPlays.toLocaleString() },
            { label: 'Tiempo total (min)', value: Math.floor(totalSeconds / 60).toLocaleString() },
          ].map((s) => (
            <div key={s.label}>
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* #37 — Price history */}
      {profile.campaigns.some((c) => c.cpm != null || c.budget != null) && (() => {
        const priced = [...profile.campaigns]
          .filter((c) => c.cpm != null || c.budget != null)
          .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
        return (
          <div className="card p-6 mb-6">
            <h2 className="font-semibold mb-4">Historial de precios</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                    <th className="text-left pb-2">Campaña</th>
                    <th className="text-left pb-2">Período</th>
                    <th className="text-right pb-2">CPM</th>
                    <th className="text-right pb-2">Presupuesto</th>
                    <th className="text-right pb-2">Meta impr.</th>
                  </tr>
                </thead>
                <tbody>
                  {priced.map((c) => (
                    <tr key={c.id} className="border-t" style={{ borderColor: 'var(--border-md)' }}>
                      <td className="py-2.5 font-medium max-w-[180px] truncate">{c.name}</td>
                      <td className="py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                        {new Date(c.startDate).toLocaleDateString('es-AR')} — {new Date(c.endDate).toLocaleDateString('es-AR')}
                      </td>
                      <td className="py-2.5 text-right tabular-nums font-medium">
                        {c.cpm != null ? `$${c.cpm}` : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        {c.budget != null ? <span className="text-emerald-600 font-medium">${c.budget}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td className="py-2.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {c.targetImpressions != null ? c.targetImpressions.toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Campaign list */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b font-semibold" style={{ borderColor: 'var(--border-md)' }}>
            Campañas ({profile.campaigns.length})
          </div>
          {profile.campaigns.length === 0 ? (
            <p className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>Sin campañas.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ background: 'var(--bg)', borderColor: 'var(--border-md)' }}>
                  <th className="text-left px-5 py-2 font-medium text-xs" style={{ color: 'var(--text-muted)' }}>Nombre</th>
                  <th className="text-left px-5 py-2 font-medium text-xs" style={{ color: 'var(--text-muted)' }}>Reproducciones</th>
                  <th className="text-left px-5 py-2 font-medium text-xs" style={{ color: 'var(--text-muted)' }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {profile.campaigns.map((c) => (
                  <tr key={c.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-5 py-2.5 font-medium">{c.name}</td>
                    <td className="px-5 py-2.5" style={{ color: 'var(--text-muted)' }}>{c.stats.plays.toLocaleString()}</td>
                    <td className="px-5 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {c.active ? 'Activa' : 'Inactiva'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* #9 — Campaign comparison bar chart */}
        <div className="card p-6">
          <h2 className="font-semibold mb-4">Comparativa de campañas</h2>
          {profile.campaigns.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sin datos.</p>
          ) : (
            <div className="space-y-3">
              {profile.campaigns.map((c, i) => {
                const pct = Math.round((c.stats.plays / maxPlays) * 100);
                return (
                  <div key={c.id}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="truncate max-w-[180px]">{c.name}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{c.stats.plays.toLocaleString()}</span>
                    </div>
                    <div className="w-full h-2 rounded-full" style={{ background: 'var(--border-md)' }}>
                      <div
                        className="h-2 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, background: CHART_COLORS[i % CHART_COLORS.length] }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
