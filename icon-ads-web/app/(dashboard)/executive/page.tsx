'use client';

import { useEffect, useState } from 'react';
import PageShell from '@/components/ui/PageShell';
import { api, DashboardSummary } from '@/lib/api';

export default function ExecutivePage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDashboardSummary()
      .then(setSummary)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const byClient = summary?.stats.playsByClient ?? [];
  const totalPlays = summary?.stats.totalPlays ?? 0;
  const onlinePct = summary
    ? (summary.stats.tablets.total > 0
        ? Math.round((summary.stats.tablets.online / summary.stats.tablets.total) * 100)
        : 0)
    : 0;

  return (
    <PageShell title="Dashboard ejecutivo" subtitle="Resumen de alto nivel del negocio.">

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Tablets online', value: `${summary?.stats.tablets.online ?? 0} / ${summary?.stats.tablets.total ?? 0}`, sub: `${onlinePct}% disponibilidad`, color: onlinePct >= 80 ? 'text-emerald-600' : onlinePct >= 50 ? 'text-amber-500' : 'text-red-500' },
              { label: 'Clientes activos', value: summary?.stats.clients ?? 0, sub: 'con contratos vigentes', color: '' },
              { label: 'Anuncios activos', value: summary?.stats.ads ?? 0, sub: `en ${summary?.stats.playlists ?? 0} playlist(s) activas`, color: '' },
              { label: 'Reproducciones', value: totalPlays.toLocaleString(), sub: 'desde que se puso el contador en cero', color: 'text-emerald-600' },
            ].map((k) => (
              <div key={k.label} className="card p-5">
                <p className={`text-3xl font-bold tabular-nums ${k.color}`}>{k.value}</p>
                <p className="text-xs font-medium mt-1">{k.label}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{k.sub}</p>
              </div>
            ))}
          </div>

          {/* Trend 30d */}
          {summary && summary.trend30d.length > 0 && (
            <div className="card p-6 mb-6">
              <h2 className="font-semibold mb-4">Tendencia 30 días — reproducciones diarias</h2>
              {(() => {
                const max = Math.max(...summary.trend30d.map((d) => d.count), 1);
                return (
                  <div className="flex items-end gap-0.5 h-32">
                    {summary.trend30d.map((d) => {
                      const pct = Math.round((d.count / max) * 100);
                      return (
                        <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5" title={`${d.date}: ${d.count}`}>
                          <div className="w-full flex flex-col justify-end" style={{ height: '100px' }}>
                            <div
                              className="w-full rounded-t transition-all"
                              style={{ height: `${Math.max(pct, d.count > 0 ? 2 : 0)}%`, background: '#3b82f6' }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              <p className="text-xs mt-2 text-right" style={{ color: 'var(--text-muted)' }}>
                Total: {summary.trend30d.reduce((s, d) => s + d.count, 0).toLocaleString()} reproducciones
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top empresas por reproducciones */}
            {byClient.length > 0 && (
              <div className="card p-6">
                <h2 className="font-semibold mb-4">Top empresas por reproducciones</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                      <th className="text-left pb-2">#</th>
                      <th className="text-left pb-2">Empresa</th>
                      <th className="text-right pb-2">Reproducciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byClient.slice(0, 10).map((c, i) => (
                      <tr key={c.clientId} className="border-t" style={{ borderColor: 'var(--border-md)' }}>
                        <td className="py-1.5 pr-2 font-bold text-xs" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                        <td className="py-1.5 truncate max-w-[180px] font-medium">{c.clientName}</td>
                        <td className="py-1.5 text-right font-medium tabular-nums">{c.count.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Recent activity */}
            {summary && summary.recentActivity.length > 0 && (
              <div className="card p-6">
                <h2 className="font-semibold mb-4">Actividad reciente</h2>
                <div className="space-y-2">
                  {summary.recentActivity.slice(0, 10).map((a) => (
                    <div key={a.id} className="flex items-start gap-2 text-sm py-1.5 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                      <span className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ background: 'var(--border-md)', color: 'var(--text-muted)' }}>
                        {a.action}
                      </span>
                      <span className="flex-1 truncate" style={{ color: 'var(--text-muted)' }}>
                        {a.entity} {a.entityId ? `#${a.entityId}` : ''}{a.details ? ` — ${a.details}` : ''}
                      </span>
                      <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-xs)' }}>
                        {new Date(a.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Anuncios que terminan pronto */}
          {summary && summary.stats.expiringAds.length > 0 && (
            <div className="card p-6 mt-6 border-l-4 border-amber-400">
              <h2 className="font-semibold mb-3">Anuncios que terminan (próximos 7 días)</h2>
              <div className="space-y-2">
                {summary.stats.expiringAds.map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{c.name}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{c.clientName}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.daysLeft <= 2 ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                      {c.daysLeft}d
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Backup download */}
          <div className="card p-4 mt-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Backup de datos</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Exportá toda la información en JSON.</p>
            </div>
            <a
              href={api.getBackupUrl()}
              className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
            >
              Descargar backup
            </a>
          </div>
        </>
      )}
    </PageShell>
  );
}
