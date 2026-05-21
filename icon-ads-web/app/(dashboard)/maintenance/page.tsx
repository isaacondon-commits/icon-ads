'use client';

import { useEffect, useState } from 'react';
import { api, Tablet } from '@/lib/api';

type MaintenanceStatus = 'scheduled' | 'overdue' | 'stale' | 'ok';

interface TabletWithStatus extends Tablet {
  maintenanceStatus: MaintenanceStatus;
  daysSinceSync: number | null;
  maintenanceDaysLeft: number | null;
}

function statusLabel(s: MaintenanceStatus) {
  if (s === 'scheduled') return { label: 'Mantenimiento programado', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' };
  if (s === 'overdue') return { label: 'Mantenimiento vencido', cls: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' };
  if (s === 'stale') return { label: 'Sin sync >7 días', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' };
  return { label: 'OK', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' };
}

export default function MaintenancePage() {
  const [tablets, setTablets] = useState<TabletWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<MaintenanceStatus | 'all'>('all');

  useEffect(() => {
    api.getTablets().then((data) => {
      const now = Date.now();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const enriched: TabletWithStatus[] = data.map((t) => {
        const lastSyncMs = t.lastSync ? new Date(t.lastSync).getTime() : null;
        const daysSinceSync = lastSyncMs != null ? Math.floor((now - lastSyncMs) / 86400000) : null;
        const maintenanceUntilMs = t.maintenanceUntil ? new Date(t.maintenanceUntil).getTime() : null;
        const maintenanceDaysLeft = maintenanceUntilMs != null ? Math.ceil((maintenanceUntilMs - now) / 86400000) : null;

        let maintenanceStatus: MaintenanceStatus = 'ok';
        if (maintenanceDaysLeft != null) {
          maintenanceStatus = maintenanceDaysLeft >= 0 ? 'scheduled' : 'overdue';
        } else if (daysSinceSync != null && lastSyncMs != null && now - lastSyncMs > sevenDaysMs) {
          maintenanceStatus = 'stale';
        }

        return { ...t, maintenanceStatus, daysSinceSync, maintenanceDaysLeft };
      });
      setTablets(enriched.sort((a, b) => {
        const order: Record<MaintenanceStatus, number> = { overdue: 0, scheduled: 1, stale: 2, ok: 3 };
        return order[a.maintenanceStatus] - order[b.maintenanceStatus];
      }));
    }).finally(() => setLoading(false));
  }, []);

  const counts = {
    overdue: tablets.filter((t) => t.maintenanceStatus === 'overdue').length,
    scheduled: tablets.filter((t) => t.maintenanceStatus === 'scheduled').length,
    stale: tablets.filter((t) => t.maintenanceStatus === 'stale').length,
    ok: tablets.filter((t) => t.maintenanceStatus === 'ok').length,
  };

  const filtered = filter === 'all' ? tablets : tablets.filter((t) => t.maintenanceStatus === filter);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Mantenimiento preventivo</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Tablets que requieren atención o tienen mantenimiento programado.</p>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {([
          { key: 'overdue', label: 'Mantenimiento vencido', color: 'text-red-500' },
          { key: 'scheduled', label: 'Mantenimiento próximo', color: 'text-amber-500' },
          { key: 'stale', label: 'Sin sync >7 días', color: 'text-orange-500' },
          { key: 'ok', label: 'En buen estado', color: 'text-emerald-600' },
        ] as { key: MaintenanceStatus; label: string; color: string }[]).map((k) => (
          <button
            key={k.key}
            onClick={() => setFilter(filter === k.key ? 'all' : k.key)}
            className={`card p-5 text-left transition-all ${filter === k.key ? 'ring-2 ring-blue-500' : ''}`}
          >
            <p className={`text-3xl font-bold tabular-nums ${k.color}`}>{counts[k.key]}</p>
            <p className="text-xs font-medium mt-1" style={{ color: 'var(--text-muted)' }}>{k.label}</p>
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
      ) : (
        <div className="card overflow-x-auto">
          <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-md)' }}>
            <p className="text-sm font-medium">{filter === 'all' ? 'Todas las tablets' : statusLabel(filter as MaintenanceStatus).label} ({filtered.length})</p>
            {filter !== 'all' && (
              <button onClick={() => setFilter('all')} className="text-xs" style={{ color: 'var(--text-muted)' }}>Ver todas</button>
            )}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                <th className="text-left px-4 py-3">Tablet</th>
                <th className="text-left px-4 py-3">Zona</th>
                <th className="text-right px-4 py-3">Último sync</th>
                <th className="text-right px-4 py-3">Mantenimiento hasta</th>
                <th className="text-right px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    Sin tablets en esta categoría.
                  </td>
                </tr>
              ) : (
                filtered.map((t) => {
                  const { label, cls } = statusLabel(t.maintenanceStatus);
                  return (
                    <tr key={t.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium">{t.name}</p>
                        <p className="text-xs font-mono" style={{ color: 'var(--text-xs)' }}>{t.deviceModel ?? t.deviceId}</p>
                      </td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{t.zone ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right text-xs">
                        {t.daysSinceSync != null ? (
                          <span className={t.daysSinceSync > 7 ? 'text-red-500 font-medium' : ''}>
                            {t.daysSinceSync === 0 ? 'Hoy' : `hace ${t.daysSinceSync}d`}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>Nunca</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs">
                        {t.maintenanceUntil ? (
                          <span className={t.maintenanceDaysLeft != null && t.maintenanceDaysLeft < 0 ? 'text-red-500 font-medium' : ''}>
                            {new Date(t.maintenanceUntil).toLocaleDateString('es-AR')}
                            {t.maintenanceDaysLeft != null && (
                              <span className="ml-1" style={{ color: 'var(--text-muted)' }}>
                                ({t.maintenanceDaysLeft >= 0 ? `en ${t.maintenanceDaysLeft}d` : `vencido ${Math.abs(t.maintenanceDaysLeft)}d`})
                              </span>
                            )}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
