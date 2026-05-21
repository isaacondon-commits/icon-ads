'use client';

import { useEffect, useState } from 'react';
import { api, Zone } from '@/lib/api';

const MONTEVIDEO_PRESETS = [
  { name: 'Centro', color: '#3b82f6', description: 'Centro histórico de Montevideo' },
  { name: 'Pocitos', color: '#10b981', description: 'Barrio residencial en la costa este' },
  { name: 'Punta Carretas', color: '#f59e0b', description: 'Zona comercial y residencial' },
  { name: 'Carrasco', color: '#8b5cf6', description: 'Barrio residencial al este' },
  { name: 'Buceo', color: '#ef4444', description: 'Zona costera central' },
  { name: 'Missile', color: '#06b6d4', description: 'Área industrial y residencial norte' },
  { name: 'Malvín', color: '#f97316', description: 'Barrio residencial costero' },
  { name: 'Aeropuerto', color: '#6366f1', description: 'Zona del Aeropuerto de Carrasco' },
];

export default function GeofencingPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', description: '', polygon: '', color: '#3b82f6' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () => api.getZones().then(setZones).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const resetForm = () => { setForm({ name: '', description: '', polygon: '', color: '#3b82f6' }); setEditId(null); setError(''); };

  const handleEdit = (z: Zone) => {
    setForm({ name: z.name, description: z.description ?? '', polygon: JSON.stringify(z.polygon, null, 2), color: z.color });
    setEditId(z.id);
    setShowForm(true);
  };

  const handlePreset = (p: typeof MONTEVIDEO_PRESETS[0]) => {
    setForm({ name: p.name, description: p.description, polygon: '[]', color: p.color });
    setEditId(null);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name) { setError('El nombre es requerido'); return; }
    let polygon: [number, number][] = [];
    if (form.polygon.trim()) {
      try { polygon = JSON.parse(form.polygon); }
      catch { setError('El polígono no es JSON válido. Formato: [[lat,lng], ...]'); return; }
    }
    setSaving(true); setError('');
    try {
      if (editId) {
        await api.updateZone(editId, { name: form.name, description: form.description || undefined, polygon, color: form.color });
      } else {
        await api.createZone({ name: form.name, description: form.description || undefined, polygon, color: form.color });
      }
      setShowForm(false); resetForm(); load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`¿Eliminar zona "${name}"?`)) return;
    await api.deleteZone(id);
    load();
  };

  const totalTablets = zones.reduce((s, z) => s + (z.tabletCount ?? 0), 0);
  const zonesWithPolygon = zones.filter((z) => Array.isArray(z.polygon) && (z.polygon as [number,number][]).length > 0).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold">Geofencing — Zonas de Montevideo</h1>
        <button onClick={() => { resetForm(); setShowForm((s) => !s); }} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          + Nueva zona
        </button>
      </div>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Definí zonas geográficas de Montevideo y asocialas a las tablets por nombre de zona.</p>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Zonas definidas', value: zones.length },
          { label: 'Con polígono', value: zonesWithPolygon, color: 'text-emerald-600' },
          { label: 'Tablets asignadas', value: totalTablets, color: 'text-blue-600' },
        ].map((k) => (
          <div key={k.label} className="card p-5">
            <p className={`text-3xl font-bold tabular-nums ${k.color ?? ''}`}>{k.value}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{k.label}</p>
          </div>
        ))}
      </div>

      {/* Presets */}
      {!showForm && (
        <div className="card p-5 mb-6">
          <h2 className="font-semibold mb-3">Barrios sugeridos de Montevideo</h2>
          <div className="flex flex-wrap gap-2">
            {MONTEVIDEO_PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => handlePreset(p)}
                disabled={zones.some((z) => z.name === p.name)}
                className="text-xs px-3 py-1.5 rounded-full font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ borderColor: p.color, color: p.color }}
              >
                {zones.some((z) => z.name === p.name) ? '✓ ' : '+ '}{p.name}
              </button>
            ))}
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>Los marcados con ✓ ya están creados. Hacé clic en cualquier barrio para pre-llenar el formulario.</p>
        </div>
      )}

      {showForm && (
        <div className="card p-5 mb-6">
          <h2 className="font-semibold mb-4">{editId ? 'Editar zona' : 'Nueva zona'}</h2>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Nombre de zona</label>
                <input className="input w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej: Centro" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Color</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-9 w-14 rounded cursor-pointer border" style={{ borderColor: 'var(--border-md)' }} />
                  <span className="text-sm font-mono">{form.color}</span>
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Descripción (opcional)</label>
              <input className="input w-full" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ej: Zona costera este de Montevideo" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Polígono (JSON array de [lat, lng]) — opcional</label>
              <textarea
                className="input w-full font-mono text-xs"
                rows={5}
                value={form.polygon}
                onChange={(e) => setForm({ ...form, polygon: e.target.value })}
                placeholder={'[[-34.9011, -56.1645], [-34.8990, -56.1600], [-34.9050, -56.1580]]'}
              />
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Ingresá coordenadas WGS84 como array de [latitud, longitud]. Podés obtenerlas desde Google Maps.</p>
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <div className="flex gap-2">
              <button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg text-sm font-medium">
                {saving ? 'Guardando...' : editId ? 'Actualizar' : 'Crear zona'}
              </button>
              <button onClick={() => { setShowForm(false); resetForm(); }} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: 'var(--border-md)' }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
      ) : zones.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No hay zonas definidas. Creá una o usá los barrios sugeridos.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide border-b" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-md)' }}>
                <th className="text-left px-4 py-3">Zona</th>
                <th className="text-left px-4 py-3">Descripción</th>
                <th className="text-right px-4 py-3">Puntos</th>
                <th className="text-right px-4 py-3">Tablets</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => {
                const pts = Array.isArray(z.polygon) ? (z.polygon as [number,number][]).length : 0;
                return (
                  <tr key={z.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ background: z.color }} />
                        <span className="font-medium">{z.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{z.description ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                      {pts > 0 ? (
                        <span className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5 rounded-full font-medium">{pts} pts</span>
                      ) : (
                        <span className="bg-gray-100 text-gray-400 dark:bg-gray-800 px-2 py-0.5 rounded-full">Sin polígono</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums">{z.tabletCount ?? 0}</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button onClick={() => handleEdit(z)} className="text-xs text-blue-500 hover:underline">Editar</button>
                        <button onClick={() => handleDelete(z.id, z.name)} className="text-xs text-red-500 hover:underline">Eliminar</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="card p-5 mt-6">
        <h2 className="font-semibold mb-2">Cómo funciona el geofencing</h2>
        <div className="space-y-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <p>1. Cada tablet tiene un campo <strong>zona</strong> (texto) que la ubica geográficamente.</p>
          <p>2. Acá definís zonas con nombre, color y polígono de coordenadas WGS84.</p>
          <p>3. Cuando el nombre de zona de una tablet coincide con el nombre de la zona definida, queda asignada automáticamente.</p>
          <p>4. Los polígonos son informativos — sirven para visualización y futura integración GPS.</p>
        </div>
      </div>
    </div>
  );
}
