'use client';

import { useEffect, useState } from 'react';
import { api, DriverPointsEntry } from '@/lib/api';

function tier(points: number) {
  if (points >= 200) return { label: 'Oro', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: '🥇' };
  if (points >= 100) return { label: 'Plata', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300', icon: '🥈' };
  if (points >= 50) return { label: 'Bronce', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', icon: '🥉' };
  return { label: 'Básico', cls: 'bg-gray-50 text-gray-400 dark:bg-gray-800', icon: '⭐' };
}

export default function DriverPointsPage() {
  const [entries, setEntries] = useState<DriverPointsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => api.getDriverPoints().then(setEntries).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const handleRecalculate = async () => {
    setRecalculating(true); setMsg('');
    try {
      const r = await api.recalculateDriverPoints();
      setMsg(`Recalculado para ${r.recalculated} tablets. Máximo: ${r.topPoints} pts.`);
      load();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Error'); }
    finally { setRecalculating(false); }
  };

  const topPoints = entries.length > 0 ? Math.max(...entries.map((e) => e.points), 1) : 1;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold">Puntos de taxistas</h1>
        <button
          onClick={handleRecalculate}
          disabled={recalculating}
          className="text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg font-medium"
        >
          {recalculating ? 'Calculando...' : 'Recalcular'}
        </button>
      </div>
      <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>Ranking de tablets por uptime (sincronizaciones exitosas en 30 días). Se recalcula automáticamente cada 24 h.</p>
      {msg && <p className="text-xs mb-4 text-emerald-600">{msg}</p>}

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Tablets rankeadas', value: entries.length },
          { label: 'Nivel Oro (200+ pts)', value: entries.filter((e) => e.points >= 200).length, color: 'text-amber-500' },
          { label: 'Nivel Plata (100+ pts)', value: entries.filter((e) => e.points >= 100 && e.points < 200).length, color: 'text-gray-500' },
        ].map((k) => (
          <div key={k.label} className="card p-5">
            <p className={`text-3xl font-bold tabular-nums ${k.color ?? ''}`}>{k.value}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{k.label}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
      ) : entries.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sin datos. Presioná "Recalcular" para inicializar.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide border-b" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-md)' }}>
                <th className="text-left px-4 py-3 w-8">#</th>
                <th className="text-left px-4 py-3">Tablet / Conductor</th>
                <th className="text-left px-4 py-3">Zona</th>
                <th className="text-right px-4 py-3">Syncs 30d</th>
                <th className="text-right px-4 py-3">Puntos</th>
                <th className="text-right px-4 py-3">Nivel</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => {
                const t = tier(e.points);
                const barPct = Math.round((e.points / topPoints) * 100);
                return (
                  <tr key={e.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-4 py-2.5 font-bold text-xs" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{e.tablet.name}</p>
                      {e.tablet.driverName && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{e.tablet.driverName}{e.tablet.licensePlate ? ` · ${e.tablet.licensePlate}` : ''}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{e.tablet.zone ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{e.syncs30d}</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 rounded-full" style={{ background: 'var(--border-md)' }}>
                          <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${barPct}%` }} />
                        </div>
                        <span className="font-bold tabular-nums">{e.points}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.cls}`}>{t.icon} {t.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
