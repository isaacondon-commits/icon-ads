'use client';

import { useEffect, useState } from 'react';
import { api, ArchivedCampaign, ArchivedAd } from '@/lib/api';
import { useToast } from '@/lib/toast-context';

type SectionTab = 'campaigns' | 'ads';

export default function ArchivePage() {
  const { show } = useToast();
  const [tab, setTab] = useState<SectionTab>('campaigns');
  const [campaigns, setCampaigns] = useState<ArchivedCampaign[]>([]);
  const [ads, setAds] = useState<ArchivedAd[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [loadingAds, setLoadingAds] = useState(true);
  const [restoringId, setRestoringId] = useState<number | null>(null);

  useEffect(() => {
    api.getArchivedCampaigns()
      .then(setCampaigns)
      .catch(() => {})
      .finally(() => setLoadingCampaigns(false));
    api.getArchivedAds()
      .then(setAds)
      .catch(() => {})
      .finally(() => setLoadingAds(false));
  }, []);

  const handleRestoreCampaign = async (id: number) => {
    setRestoringId(id);
    try {
      await api.reactivateCampaign(id);
      setCampaigns((prev) => prev.filter((c) => c.id !== id));
      show('Campaña restaurada correctamente');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error al restaurar', 'error');
    } finally {
      setRestoringId(null);
    }
  };

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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Archivo</h1>
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Elementos eliminados que pueden restaurarse
        </span>
      </div>

      {/* Tabs */}
      <div className="card overflow-hidden">
        <div className="flex border-b" style={{ borderColor: 'var(--border-md)' }}>
          {(['campaigns', 'ads'] as SectionTab[]).map((t) => {
            const label = t === 'campaigns'
              ? `Campañas (${campaigns.length})`
              : `Anuncios (${ads.length})`;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent'}`}
                style={tab !== t ? { color: 'var(--text-muted)' } : undefined}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Campaigns tab */}
        {tab === 'campaigns' && (
          loadingCampaigns ? (
            <p className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
          ) : campaigns.length === 0 ? (
            <p className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>No hay campañas eliminadas.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide" style={{ background: 'var(--bg)', borderColor: 'var(--border-md)', color: 'var(--text-muted)' }}>
                  <th className="text-left px-5 py-3">Campaña</th>
                  <th className="text-left px-5 py-3">Cliente</th>
                  <th className="text-right px-5 py-3">Anuncios</th>
                  <th className="text-right px-5 py-3">Eliminada</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-5 py-3 font-medium">{c.name}</td>
                    <td className="px-5 py-3" style={{ color: 'var(--text-muted)' }}>{c.client?.name ?? '—'}</td>
                    <td className="px-5 py-3 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      {c._count.ads}
                    </td>
                    <td className="px-5 py-3 text-right text-xs" style={{ color: 'var(--text-xs)' }}>
                      {c.deletedAt ? new Date(c.deletedAt).toLocaleDateString('es-AR') : '—'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => handleRestoreCampaign(c.id)}
                        disabled={restoringId === c.id}
                        className="text-xs text-emerald-600 hover:underline disabled:opacity-50"
                      >
                        {restoringId === c.id ? 'Restaurando...' : 'Restaurar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {/* Ads tab */}
        {tab === 'ads' && (
          loadingAds ? (
            <p className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>Cargando...</p>
          ) : ads.length === 0 ? (
            <p className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>No hay anuncios eliminados.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide" style={{ background: 'var(--bg)', borderColor: 'var(--border-md)', color: 'var(--text-muted)' }}>
                  <th className="text-left px-5 py-3">Anuncio</th>
                  <th className="text-left px-5 py-3">Tipo</th>
                  <th className="text-left px-5 py-3">Campaña</th>
                  <th className="text-left px-5 py-3">Cliente</th>
                  <th className="text-right px-5 py-3">Eliminado</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {ads.map((a) => (
                  <tr key={a.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-5 py-3 font-medium max-w-[160px] truncate">{a.name}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${a.type === 'video' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>
                        {a.type}
                      </span>
                    </td>
                    <td className="px-5 py-3 max-w-[140px] truncate" style={{ color: 'var(--text-muted)' }}>{a.campaign.name}</td>
                    <td className="px-5 py-3 max-w-[120px] truncate" style={{ color: 'var(--text-muted)' }}>{a.campaign.client.name}</td>
                    <td className="px-5 py-3 text-right text-xs" style={{ color: 'var(--text-xs)' }}>
                      {a.deletedAt ? new Date(a.deletedAt).toLocaleDateString('es-AR') : '—'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => handleRestoreAd(a.id)}
                        disabled={restoringId === a.id}
                        className="text-xs text-emerald-600 hover:underline disabled:opacity-50"
                      >
                        {restoringId === a.id ? 'Restaurando...' : 'Restaurar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}
