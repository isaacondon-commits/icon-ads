'use client';

import { useEffect, useState } from 'react';
import { api, SystemLogEntry, AuditPage, BASE } from '@/lib/api';

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-emerald-100 text-emerald-700',
  UPDATE: 'bg-blue-100 text-blue-700',
  UPDATE_ADS: 'bg-blue-100 text-blue-700',
  DELETE: 'bg-red-100 text-red-700',
  REACTIVATE: 'bg-violet-100 text-violet-700',
  APPROVE: 'bg-emerald-100 text-emerald-700',
  REJECT: 'bg-red-100 text-red-700',
  PAUSE: 'bg-amber-100 text-amber-700',
  RESUME: 'bg-emerald-100 text-emerald-700',
  FORCE_SYNC: 'bg-cyan-100 text-cyan-700',
  TABLET_OFFLINE: 'bg-orange-100 text-orange-700',
  TABLET_BACK_ONLINE: 'bg-emerald-100 text-emerald-700',
  UPLOAD: 'bg-violet-100 text-violet-700',
  REVERT: 'bg-amber-100 text-amber-700',
};

function badge(action: string) {
  const cls = ACTION_COLORS[action] ?? 'bg-gray-100 text-gray-600';
  return <span className={`text-xs px-2 py-0.5 rounded font-mono font-medium ${cls}`}>{action}</span>;
}

export default function LogsPage() {
  const [tab, setTab] = useState<'live' | 'audit'>('live');
  const [live, setLive] = useState<SystemLogEntry[]>([]);
  const [audit, setAudit] = useState<AuditPage | null>(null);
  const [auditPage, setAuditPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (tab === 'live') {
      setLoading(true);
      api.getLogs().then(setLive).finally(() => setLoading(false));
    } else {
      setLoading(true);
      api.getAuditLogs(auditPage).then(setAudit).finally(() => setLoading(false));
    }
  }, [tab, auditPage]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Logs del sistema</h1>

      <div className="flex items-center justify-between mb-6">
        <div className="flex rounded-lg border overflow-hidden w-fit" style={{ borderColor: 'var(--border-md)' }}>
        {(['live', 'audit'] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setAuditPage(1); }}
            className={`px-4 py-2 text-sm font-medium border-r last:border-0 ${tab === t ? 'bg-blue-600 text-white' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
            style={{ borderColor: 'var(--border-md)' }}
          >
            {t === 'live' ? '⚡ Eventos recientes' : '📋 Auditoría completa'}
          </button>
        ))}
        </div>
        {tab === 'audit' && (
          <a
            href={api.getAuditCsvUrl()}
            className="text-sm text-blue-600 border border-blue-200 hover:bg-blue-50 px-3 py-1.5 rounded-lg font-medium"
            download
          >
            Exportar CSV
          </a>
        )}
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Cargando...</p>
      ) : tab === 'live' ? (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ background: 'var(--bg)', borderColor: 'var(--border-md)' }}>
                <th className="text-left px-5 py-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Acción</th>
                <th className="text-left px-5 py-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Entidad</th>
                <th className="text-left px-5 py-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Detalle</th>
                <th className="text-left px-5 py-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {live.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>Sin eventos recientes.</td></tr>
              ) : (
                live.map((e) => (
                  <tr key={e.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-5 py-2.5">{badge(e.action)}</td>
                    <td className="px-5 py-2.5 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                      {e.entity}{e.entityId ? `#${e.entityId}` : ''}
                    </td>
                    <td className="px-5 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{e.details ?? '—'}</td>
                    <td className="px-5 py-2.5 text-xs" style={{ color: 'var(--text-xs)' }}>
                      {new Date(e.timestamp).toLocaleString('es-AR')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        audit && (
          <>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b" style={{ background: 'var(--bg)', borderColor: 'var(--border-md)' }}>
                    <th className="text-left px-5 py-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Acción</th>
                    <th className="text-left px-5 py-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Entidad</th>
                    <th className="text-left px-5 py-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Detalle</th>
                    <th className="text-left px-5 py-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Usuario</th>
                    <th className="text-left px-5 py-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.logs.length === 0 ? (
                    <tr><td colSpan={5} className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>Sin registros.</td></tr>
                  ) : (
                    audit.logs.map((e) => (
                      <tr key={e.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                        <td className="px-5 py-2.5">{badge(e.action)}</td>
                        <td className="px-5 py-2.5 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                          {e.entity}{e.entityId ? `#${e.entityId}` : ''}
                        </td>
                        <td className="px-5 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{e.details ?? '—'}</td>
                        <td className="px-5 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{e.user?.name ?? '—'}</td>
                        <td className="px-5 py-2.5 text-xs" style={{ color: 'var(--text-xs)' }}>
                          {new Date(e.createdAt).toLocaleString('es-AR')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {audit.pages > 1 && (
              <div className="flex items-center justify-between mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>
                <span>{audit.total} registros · página {audit.page} de {audit.pages}</span>
                <div className="flex gap-1">
                  <button disabled={auditPage === 1} onClick={() => setAuditPage(p => p - 1)} className="px-3 py-1 rounded border disabled:opacity-40" style={{ borderColor: 'var(--border-md)' }}>‹</button>
                  <button disabled={auditPage === audit.pages} onClick={() => setAuditPage(p => p + 1)} className="px-3 py-1 rounded border disabled:opacity-40" style={{ borderColor: 'var(--border-md)' }}>›</button>
                </div>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
