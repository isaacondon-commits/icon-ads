'use client';

import { useEffect, useRef, useState } from 'react';
import { api, AdminNote } from '@/lib/api';

export default function NotesPage() {
  const [notes, setNotes] = useState<AdminNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.getNotes().then(setNotes).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    const body = textareaRef.current?.value.trim();
    if (!body) return;
    setSaving(true);
    try {
      const note = await api.createNote(body);
      setNotes((prev) => [note, ...prev]);
      if (textareaRef.current) textareaRef.current.value = '';
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await api.deleteNote(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Notas del panel</h1>

      <div className="card p-5 mb-6">
        <textarea
          ref={textareaRef}
          rows={4}
          placeholder="Escribí una nota para el equipo..."
          className="w-full input resize-none text-sm"
          style={{ fontFamily: 'inherit' }}
        />
        <div className="flex justify-end mt-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            {saving ? 'Guardando...' : 'Guardar nota'}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
      ) : notes.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No hay notas todavía.</p>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <div key={note.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm whitespace-pre-wrap flex-1" style={{ color: 'var(--text-muted)' }}>
                  {note.body}
                </p>
                <button
                  onClick={() => handleDelete(note.id)}
                  disabled={deletingId === note.id}
                  className="text-xs px-2 py-1 rounded border hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors disabled:opacity-40 shrink-0"
                  style={{ borderColor: 'var(--border-md)', color: 'var(--text-muted)' }}
                >
                  {deletingId === note.id ? '...' : 'Eliminar'}
                </button>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs font-medium">{note.authorName}</span>
                <span className="text-xs" style={{ color: 'var(--text-xs)' }}>
                  {new Date(note.createdAt).toLocaleString('es-AR')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
