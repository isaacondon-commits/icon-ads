'use client';

import { useEffect, useState } from 'react';
import { api, Tablet } from '@/lib/api';

function batteryColor(level: number | null | undefined) {
  if (level == null) return 'text-gray-400';
  if (level >= 50) return 'text-emerald-600';
  if (level >= 20) return 'text-amber-500';
  return 'text-red-500';
}

export default function InventoryPage() {
  const [tablets, setTablets] = useState<Tablet[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'battery' | 'model' | 'zone'>('name');

  useEffect(() => {
    api.getTablets().then(setTablets).finally(() => setLoading(false));
  }, []);

  // eslint-disable-next-line react-hooks/purity -- online/offline status reads wall-clock time; no React Compiler in use, no SSR of this data
  const now = Date.now();
  const onlineThreshold = 10 * 60 * 1000;

  const filtered = tablets
    .filter((t) => {
      const q = search.toLowerCase();
      return (
        t.name.toLowerCase().includes(q) ||
        (t.zone ?? '').toLowerCase().includes(q) ||
        (t.deviceModel ?? '').toLowerCase().includes(q) ||
        (t.osVersion ?? '').toLowerCase().includes(q) ||
        t.deviceId.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortBy === 'battery') return (b.batteryLevel ?? -1) - (a.batteryLevel ?? -1);
      if (sortBy === 'model') return (a.deviceModel ?? '').localeCompare(b.deviceModel ?? '');
      if (sortBy === 'zone') return (a.zone ?? '').localeCompare(b.zone ?? '');
      return a.name.localeCompare(b.name);
    });

  const totalOnline = tablets.filter((t) => t.lastSync && now - new Date(t.lastSync).getTime() < onlineThreshold).length;
  const withModel = tablets.filter((t) => t.deviceModel).length;
  const avgBattery = tablets.filter((t) => t.batteryLevel != null).length > 0
    ? Math.round(tablets.reduce((s, t) => s + (t.batteryLevel ?? 0), 0) / tablets.filter((t) => t.batteryLevel != null).length)
    : null;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Inventario de hardware</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Estado y especificaciones de todas las tablets.</p>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total tablets', value: tablets.length },
          { label: 'Online ahora', value: totalOnline, color: 'text-emerald-600' },
          { label: 'Modelo conocido', value: `${withModel} / ${tablets.length}` },
          { label: 'Batería promedio', value: avgBattery != null ? `${avgBattery}%` : '—', color: avgBattery != null ? batteryColor(avgBattery) : '' },
        ].map((k) => (
          <div key={k.label} className="card p-5">
            <p className={`text-3xl font-bold tabular-nums ${k.color ?? ''}`}>{k.value}</p>
            <p className="text-xs mt-1 font-medium" style={{ color: 'var(--text-muted)' }}>{k.label}</p>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="search"
          placeholder="Buscar tablet, zona, modelo..."
          className="input flex-1 min-w-48"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
          <option value="name">Ordenar: nombre</option>
          <option value="zone">Ordenar: zona</option>
          <option value="model">Ordenar: modelo</option>
          <option value="battery">Ordenar: batería</option>
        </select>
        <a
          href={api.getTabletsCsvUrl()}
          className="text-sm bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          Exportar CSV
        </a>
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide border-b" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-md)' }}>
                <th className="text-left px-4 py-3">Tablet</th>
                <th className="text-left px-4 py-3">Zona</th>
                <th className="text-left px-4 py-3">Modelo</th>
                <th className="text-left px-4 py-3">Android</th>
                <th className="text-left px-4 py-3">App</th>
                <th className="text-right px-4 py-3">Batería</th>
                <th className="text-right px-4 py-3">Estado</th>
                <th className="text-right px-4 py-3">Último sync</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    Sin resultados.
                  </td>
                </tr>
              ) : (
                filtered.map((t) => {
                  const isOnline = t.lastSync && now - new Date(t.lastSync).getTime() < onlineThreshold;
                  const lastSyncDate = t.lastSync ? new Date(t.lastSync) : null;
                  const minutesAgo = lastSyncDate ? Math.floor((now - lastSyncDate.getTime()) / 60000) : null;
                  return (
                    <tr key={t.id} className="border-t hover:bg-opacity-50" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium">{t.name}</p>
                        <p className="text-xs font-mono" style={{ color: 'var(--text-xs)' }}>{t.deviceId}</p>
                      </td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{t.zone ?? '—'}</td>
                      <td className="px-4 py-2.5 text-xs">{t.deviceModel ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                      <td className="px-4 py-2.5 text-xs font-mono">{t.osVersion ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                      <td className="px-4 py-2.5 text-xs font-mono">{t.appVersion ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                      <td className="px-4 py-2.5 text-right">
                        {t.batteryLevel != null ? (
                          <span className={`text-sm font-bold tabular-nums ${batteryColor(t.batteryLevel)}`}>
                            {t.batteryLevel}%
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isOnline ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                          {isOnline ? 'online' : 'offline'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                        {minutesAgo != null
                          ? minutesAgo < 60
                            ? `${minutesAgo}m`
                            : minutesAgo < 1440
                              ? `${Math.floor(minutesAgo / 60)}h`
                              : `${Math.floor(minutesAgo / 1440)}d`
                          : '—'}
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
