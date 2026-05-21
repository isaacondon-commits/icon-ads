'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast-context';

interface Survey {
  id: number;
  question: string;
  options: string[];
  active: boolean;
  answer_count: number;
  created_at: string;
}

interface SurveyResult {
  survey: Survey;
  answers: { option_index: number; count: number }[];
}

export default function SurveysPage() {
  const { show } = useToast();
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<SurveyResult | null>(null);

  const load = () =>
    api.getSurveys().then(setSurveys).catch(() => {}).finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    const cleanOpts = options.filter((o) => o.trim());
    if (!question.trim() || cleanOpts.length < 2) {
      show('Ingresá la pregunta y al menos 2 opciones', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.createSurvey({ question: question.trim(), options: cleanOpts });
      setShowModal(false);
      setQuestion('');
      setOptions(['', '']);
      load();
      show('Encuesta creada');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error', 'error');
    } finally { setSaving(false); }
  };

  const handleToggle = async (id: number) => {
    try {
      await api.toggleSurvey(id);
      load();
    } catch (e) { show(e instanceof Error ? e.message : 'Error', 'error'); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('¿Eliminar encuesta?')) return;
    try {
      await api.deleteSurvey(id);
      load();
      show('Encuesta eliminada');
    } catch (e) { show(e instanceof Error ? e.message : 'Error', 'error'); }
  };

  const handleViewResults = async (id: number) => {
    try {
      const data = await api.getSurveyResults(id);
      setResults(data);
    } catch (e) { show(e instanceof Error ? e.message : 'Error', 'error'); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Encuestas para taxistas</h1>
        <button
          onClick={() => { setQuestion(''); setOptions(['', '']); setShowModal(true); }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          + Nueva encuesta
        </button>
      </div>

      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        Las encuestas activas aparecen en las tablets una vez por dispositivo. Los taxistas responden tocando una opción.
      </p>

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Cargando...</p>
      ) : surveys.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>No hay encuestas. Creá la primera.</p>
      ) : (
        <div className="space-y-4">
          {surveys.map((s) => {
            const total = s.answer_count;
            return (
              <div key={s.id} className="card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
                        {s.active ? 'Activa' : 'Inactiva'}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {total} {total === 1 ? 'respuesta' : 'respuestas'}
                      </span>
                    </div>
                    <p className="font-semibold">{s.question}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {(s.options as string[]).map((o, i) => (
                        <span key={i} className="text-xs px-2 py-1 rounded border" style={{ borderColor: 'var(--border-md)', color: 'var(--text-muted)' }}>
                          {o}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {total > 0 && (
                      <button
                        onClick={() => handleViewResults(s.id)}
                        className="text-xs px-3 py-1.5 rounded border font-medium"
                        style={{ borderColor: 'var(--border-md)', color: 'var(--text-muted)' }}
                      >
                        Ver resultados
                      </button>
                    )}
                    <button
                      onClick={() => handleToggle(s.id)}
                      className={`text-xs px-3 py-1.5 rounded border font-medium ${s.active ? 'border-yellow-400 text-yellow-600' : 'border-green-400 text-green-600'}`}
                    >
                      {s.active ? 'Pausar' : 'Activar'}
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="text-xs px-3 py-1.5 rounded border border-red-300 text-red-500 font-medium"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="card p-6 w-full max-w-lg" style={{ background: 'var(--card)' }}>
            <h2 className="text-lg font-bold mb-4">Nueva encuesta</h2>
            <label className="block text-sm font-medium mb-1">Pregunta</label>
            <input
              className="input w-full mb-4"
              placeholder="¿Cómo evaluás el estado del tráfico hoy?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <label className="block text-sm font-medium mb-2">Opciones (2 a 4)</label>
            <div className="space-y-2 mb-4">
              {options.map((opt, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    className="input flex-1"
                    placeholder={`Opción ${i + 1}`}
                    value={opt}
                    onChange={(e) => setOptions((prev) => prev.map((o, j) => j === i ? e.target.value : o))}
                  />
                  {options.length > 2 && (
                    <button
                      onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                      className="text-red-400 hover:text-red-600 text-lg"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {options.length < 4 && (
                <button
                  onClick={() => setOptions((prev) => [...prev, ''])}
                  className="text-sm text-blue-500 hover:text-blue-700"
                >
                  + Agregar opción
                </button>
              )}
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm rounded-lg border" style={{ borderColor: 'var(--border-md)' }}>
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={saving}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50"
              >
                {saving ? 'Guardando...' : 'Crear encuesta'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Results modal */}
      {results && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="card p-6 w-full max-w-lg" style={{ background: 'var(--card)' }}>
            <h2 className="text-lg font-bold mb-1">Resultados</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>{results.survey.question}</p>
            {(() => {
              const total = results.answers.reduce((s, a) => s + a.count, 0);
              const opts = results.survey.options as string[];
              return (
                <div className="space-y-3">
                  {opts.map((opt, i) => {
                    const answer = results.answers.find((a) => a.option_index === i);
                    const count = answer?.count ?? 0;
                    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                    return (
                      <div key={i}>
                        <div className="flex justify-between text-sm mb-1">
                          <span>{opt}</span>
                          <span style={{ color: 'var(--text-muted)' }}>{count} ({pct}%)</span>
                        </div>
                        <div className="w-full h-2 rounded-full" style={{ background: 'var(--border-md)' }}>
                          <div className="h-2 rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>Total: {total} respuestas</p>
                </div>
              );
            })()}
            <div className="flex justify-end mt-4">
              <button onClick={() => setResults(null)} className="px-4 py-2 text-sm rounded-lg border" style={{ borderColor: 'var(--border-md)' }}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
