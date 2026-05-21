'use client';

import { useEffect, useState } from 'react';
import { api, AbTest, Ad } from '@/lib/api';

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  paused: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  finished: 'bg-gray-100 text-gray-500 dark:bg-gray-800',
};

export default function AbTestsPage() {
  const [tests, setTests] = useState<AbTest[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', adAId: '', adBId: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () =>
    Promise.all([api.getAbTests(), api.getAds()])
      .then(([t, a]) => { setTests(t); setAds(a.filter((ad) => ad.active && !ad.deletedAt)); })
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!form.name || !form.adAId || !form.adBId) { setError('Completá todos los campos'); return; }
    setSaving(true); setError('');
    try {
      await api.createAbTest({ name: form.name, adAId: Number(form.adAId), adBId: Number(form.adBId) });
      setShowForm(false); setForm({ name: '', adAId: '', adBId: '' }); load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">A/B Testing</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Mostrá la versión A al 50% de las tablets y la versión B al otro 50%.</p>
        </div>
        <button onClick={() => setShowForm((s) => !s)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          + Nuevo test
        </button>
      </div>

      {showForm && (
        <div className="card p-5 mb-6">
          <h2 className="font-semibold mb-4">Nuevo test A/B</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Nombre del test</label>
              <input className="input w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej: Prueba banner verano" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Versión A (50% tablets)</label>
                <select className="input w-full" value={form.adAId} onChange={(e) => setForm({ ...form, adAId: e.target.value })}>
                  <option value="">Seleccionar anuncio</option>
                  {ads.filter((a) => a.id !== Number(form.adBId)).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Versión B (50% tablets)</label>
                <select className="input w-full" value={form.adBId} onChange={(e) => setForm({ ...form, adBId: e.target.value })}>
                  <option value="">Seleccionar anuncio</option>
                  {ads.filter((a) => a.id !== Number(form.adAId)).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <div className="flex gap-2">
              <button onClick={handleCreate} disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg text-sm font-medium">
                {saving ? 'Creando...' : 'Crear test'}
              </button>
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: 'var(--border-md)' }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
      ) : tests.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No hay tests A/B. Creá uno para empezar.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {tests.map((t) => {
            const totalPlays = (t.playsA ?? 0) + (t.playsB ?? 0);
            const pctA = totalPlays > 0 ? Math.round(((t.playsA ?? 0) / totalPlays) * 100) : 50;
            const pctB = 100 - pctA;
            const winnerA = (t.playsA ?? 0) > (t.playsB ?? 0);
            return (
              <div key={t.id} className="card p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="font-semibold">{t.name}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{new Date(t.createdAt).toLocaleDateString('es-AR')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[t.status] ?? ''}`}>{t.status}</span>
                    <select
                      value={t.status}
                      onChange={async (e) => { await api.updateAbTestStatus(t.id, e.target.value); load(); }}
                      className="text-xs border rounded px-1.5 py-0.5"
                      style={{ borderColor: 'var(--border-md)', background: 'var(--card)' }}
                    >
                      <option value="active">activo</option>
                      <option value="paused">pausado</option>
                      <option value="finished">finalizado</option>
                    </select>
                    <button onClick={async () => { if (confirm('¿Eliminar test?')) { await api.deleteAbTest(t.id); load(); } }} className="text-xs text-red-500 hover:underline">Eliminar</button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: 'Versión A', ad: t.adA, plays: t.playsA ?? 0, tablets: t.tabletsA ?? 0, pct: pctA, winner: winnerA },
                    { label: 'Versión B', ad: t.adB, plays: t.playsB ?? 0, tablets: t.tabletsB ?? 0, pct: pctB, winner: !winnerA },
                  ].map((v) => (
                    <div key={v.label} className={`p-4 rounded-xl border ${v.winner && totalPlays > 0 ? 'border-emerald-400' : ''}`} style={{ background: 'var(--bg)', borderColor: v.winner && totalPlays > 0 ? undefined : 'var(--border-md)' }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold">{v.label}</span>
                        {v.winner && totalPlays > 0 && <span className="text-xs font-bold text-emerald-600">Ganando</span>}
                      </div>
                      <p className="text-sm font-medium truncate">{v.ad.name}</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{v.tablets} tablets · {v.plays.toLocaleString()} reprod.</p>
                      <div className="mt-2 w-full h-2 rounded-full" style={{ background: 'var(--border-md)' }}>
                        <div className="h-2 rounded-full bg-blue-500" style={{ width: `${v.pct}%` }} />
                      </div>
                      <p className="text-xs mt-1 text-right font-medium">{v.pct}%</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
