'use client';

import { useEffect, useState } from 'react';
import { api, Reminder } from '@/lib/api';

function isPast(dueAt: string | null) {
  if (!dueAt) return false;
  return new Date(dueAt).getTime() < Date.now();
}

function isToday(dueAt: string | null) {
  if (!dueAt) return false;
  const d = new Date(dueAt);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export default function RemindersPage() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: '', body: '', dueAt: '' });
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = () => api.getReminders().then(setReminders).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await api.createReminder({
        title: form.title.trim(),
        body: form.body.trim() || null,
        dueAt: form.dueAt || null,
      });
      setForm({ title: '', body: '', dueAt: '' });
      setShowForm(false);
      load();
    } finally { setSaving(false); }
  };

  const handleToggle = async (r: Reminder) => {
    await api.updateReminder(r.id, { done: !r.done });
    load();
  };

  const handleDelete = async (id: number) => {
    await api.deleteReminder(id);
    load();
  };

  const pending = reminders.filter((r) => !r.done);
  const done = reminders.filter((r) => r.done);
  const overdue = pending.filter((r) => isPast(r.dueAt) && !isToday(r.dueAt));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Recordatorios</h1>
          {overdue.length > 0 && (
            <p className="text-sm text-red-500 mt-0.5">{overdue.length} recordatorio{overdue.length !== 1 ? 's' : ''} vencido{overdue.length !== 1 ? 's' : ''}</p>
          )}
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          + Nuevo
        </button>
      </div>

      {showForm && (
        <div className="card p-5 mb-6">
          <h2 className="font-semibold mb-4">Nuevo recordatorio</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs mb-1 font-medium" style={{ color: 'var(--text-muted)' }}>Título</label>
              <input
                className="input w-full"
                placeholder="¿Qué tenés que recordar?"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div>
              <label className="block text-xs mb-1 font-medium" style={{ color: 'var(--text-muted)' }}>Detalle (opcional)</label>
              <textarea
                className="input w-full resize-none"
                rows={2}
                placeholder="Notas adicionales..."
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs mb-1 font-medium" style={{ color: 'var(--text-muted)' }}>Fecha límite (opcional)</label>
              <input
                type="datetime-local"
                className="input"
                value={form.dueAt}
                onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleCreate}
                disabled={saving || !form.title.trim()}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-lg text-sm border"
                style={{ borderColor: 'var(--border-md)' }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
      ) : (
        <>
          {pending.length === 0 && done.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No hay recordatorios. ¡Creá uno!</p>
            </div>
          ) : (
            <>
              {/* Pending */}
              {pending.length > 0 && (
                <div className="card overflow-hidden mb-4">
                  <div className="px-4 py-3 border-b text-xs font-semibold uppercase tracking-wide" style={{ borderColor: 'var(--border-md)', color: 'var(--text-muted)' }}>
                    Pendientes ({pending.length})
                  </div>
                  <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                    {pending.map((r) => {
                      const past = isPast(r.dueAt) && !isToday(r.dueAt);
                      const today = isToday(r.dueAt);
                      return (
                        <div key={r.id} className="flex items-start gap-3 px-4 py-3">
                          <button
                            onClick={() => handleToggle(r)}
                            className="mt-0.5 w-5 h-5 rounded border-2 shrink-0 flex items-center justify-center transition-colors"
                            style={{ borderColor: 'var(--border-md)' }}
                          >
                            <span />
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className={`font-medium text-sm ${past ? 'text-red-500' : ''}`}>{r.title}</p>
                            {r.body && <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{r.body}</p>}
                            {r.dueAt && (
                              <p className={`text-xs mt-1 ${past ? 'text-red-500 font-medium' : today ? 'text-amber-500 font-medium' : ''}`} style={!past && !today ? { color: 'var(--text-xs)' } : {}}>
                                {past ? 'Vencido: ' : today ? 'Hoy: ' : ''}{new Date(r.dueAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => handleDelete(r.id)}
                            className="text-xs shrink-0"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Done */}
              {done.length > 0 && (
                <div className="card overflow-hidden opacity-60">
                  <div className="px-4 py-3 border-b text-xs font-semibold uppercase tracking-wide" style={{ borderColor: 'var(--border-md)', color: 'var(--text-muted)' }}>
                    Completados ({done.length})
                  </div>
                  <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                    {done.map((r) => (
                      <div key={r.id} className="flex items-start gap-3 px-4 py-3">
                        <button
                          onClick={() => handleToggle(r)}
                          className="mt-0.5 w-5 h-5 rounded border-2 shrink-0 flex items-center justify-center bg-emerald-500 border-emerald-500 text-white text-xs"
                        >
                          ✓
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm line-through" style={{ color: 'var(--text-muted)' }}>{r.title}</p>
                        </div>
                        <button
                          onClick={() => handleDelete(r.id)}
                          className="text-xs shrink-0"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
