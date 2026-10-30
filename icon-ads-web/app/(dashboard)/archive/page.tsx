'use client';

import { useEffect, useState } from 'react';
import PageShell from '@/components/ui/PageShell';
import { api, ArchivedAd } from '@/lib/api';
import { useToast } from '@/lib/toast-context';
import ConfirmDialog from '@/components/ConfirmDialog';

type DeleteTarget = { id: number; name: string };

export default function ArchivePage() {
  const { show } = useToast();
  const [ads, setAds] = useState<ArchivedAd[]>([]);
  const [loadingAds, setLoadingAds] = useState(true);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api.getArchivedAds()
      .then(setAds)
      .catch(() => {})
      .finally(() => setLoadingAds(false));
  }, []);

  const handleRestoreAd = async (id: number) => {
    setRestoringId(id);
    try {
      await api.restoreAd(id);
      setAds((prev) => prev.filter((a) => a.id !== id));
      show('Anuncio restaurado correctamente');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error al restaurar', 'error');
    } finally {
      setRestoringId(null);
    }
  };

  const handlePermanentDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.permanentDeleteAd(deleteTarget.id);
      setAds((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      show('Anuncio eliminado definitivamente');
      setDeleteTarget(null);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error al eliminar', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <PageShell title="Archivo" subtitle="Anuncios eliminados que pueden restaurarse.">
      <div className="card overflow-hidden">
        {loadingAds ? (
          <p className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
        ) : ads.length === 0 ? (
          <p className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>No hay anuncios eliminados.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wide" style={{ background: 'var(--bg)', borderColor: 'var(--border-md)', color: 'var(--text-muted)' }}>
                <th className="text-left px-5 py-3">Anuncio</th>
                <th className="text-left px-5 py-3">Tipo</th>
                <th className="text-left px-5 py-3">Empresa</th>
                <th className="text-right px-5 py-3">Eliminado</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {ads.map((a) => (
                <tr key={a.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-5 py-3 font-medium max-w-[200px] truncate">{a.name}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${a.type === 'video' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>
                      {a.type}
                    </span>
                  </td>
                  <td className="px-5 py-3 max-w-[160px] truncate" style={{ color: 'var(--text-muted)' }}>{a.client?.name ?? '—'}</td>
                  <td className="px-5 py-3 text-right text-xs" style={{ color: 'var(--text-xs)' }}>
                    {a.deletedAt ? new Date(a.deletedAt).toLocaleDateString('es-AR') : '—'}
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => handleRestoreAd(a.id)}
                      disabled={restoringId === a.id}
                      className="text-xs text-emerald-600 hover:underline disabled:opacity-50"
                    >
                      {restoringId === a.id ? 'Restaurando...' : 'Restaurar'}
                    </button>
                    <button
                      onClick={() => setDeleteTarget({ id: a.id, name: a.name })}
                      className="text-xs text-red-600 hover:underline ml-3"
                    >
                      Eliminar definitivamente
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="Eliminar definitivamente"
          message={`¿Eliminar para siempre el anuncio "${deleteTarget.name}" y su archivo? No se puede deshacer.`}
          confirmLabel={deleting ? 'Eliminando...' : 'Eliminar definitivamente'}
          onConfirm={handlePermanentDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </PageShell>
  );
}
