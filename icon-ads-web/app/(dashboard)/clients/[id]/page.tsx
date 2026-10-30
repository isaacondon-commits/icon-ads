'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, ClientProfile } from '@/lib/api';

const CHART_COLORS = ['#3b82f6','#8b5cf6','#f59e0b','#10b981','#ef4444','#06b6d4'];

const adState = (a: ClientProfile['ads'][number]) =>
  a.approvalStatus === 'pending' ? ['Pendiente', 'bg-amber-100 text-amber-700']
    : a.approvalStatus === 'rejected' ? ['Rechazado', 'bg-red-100 text-red-700']
      : a.active ? ['Activo', 'bg-emerald-100 text-emerald-700'] : ['Pausado', 'bg-gray-100 text-gray-500'];

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
  }, [id, router]);

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Cargando perfil...</p>;
  if (!profile) return null;

  const totalPlays = profile.ads.reduce((s, a) => s + a.stats.plays, 0);
  const totalSeconds = profile.ads.reduce((s, a) => s + a.stats.totalSeconds, 0);
  const activeAds = profile.ads.filter((a) => a.active && a.approvalStatus === 'approved').length;
  const maxPlays = Math.max(...profile.ads.map((a) => a.stats.plays), 1);
  const byPlays = [...profile.ads].sort((a, b) => b.stats.plays - a.stats.plays);

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
          <div className="flex items-center gap-2">
            <a
              href={api.getProposalUrl(profile.id)}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
            >
              Propuesta PDF
            </a>
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${profile.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
              {profile.active ? 'Activo' : 'Inactivo'}
            </span>
          </div>
        </div>
        {/* Summary row */}
        <div className="grid grid-cols-3 gap-4 mt-5 pt-5 border-t" style={{ borderColor: 'var(--border-md)' }}>
          {[
            { label: 'Anuncios activos', value: activeAds },
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Anuncios de la empresa */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b font-semibold" style={{ borderColor: 'var(--border-md)' }}>
            Anuncios ({profile.ads.length})
          </div>
          {profile.ads.length === 0 ? (
            <p className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>Sin anuncios.</p>
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
                {profile.ads.map((a) => {
                  const [label, cls] = adState(a);
                  return (
                    <tr key={a.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-5 py-2.5">
                        <p className="font-medium">{a.name}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>En el portal: {a.publicName || 'Anuncio N (sin nombre público)'}</p>
                      </td>
                      <td className="px-5 py-2.5" style={{ color: 'var(--text-muted)' }}>{a.stats.plays.toLocaleString()}</td>
                      <td className="px-5 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Comparativa de anuncios */}
        <div className="card p-6">
          <h2 className="font-semibold mb-4">Reproducciones por anuncio</h2>
          {profile.ads.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sin datos.</p>
          ) : (
            <div className="space-y-3">
              {byPlays.map((a, i) => {
                const pct = Math.round((a.stats.plays / maxPlays) * 100);
                return (
                  <div key={a.id}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="truncate max-w-[180px]">{a.name}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{a.stats.plays.toLocaleString()}</span>
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
