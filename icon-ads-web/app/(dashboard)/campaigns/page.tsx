'use client';

import { useEffect, useState } from 'react';
import { api, Campaign, Client, CampaignTemplate, Favorite } from '@/lib/api';
import ConfirmDialog from '@/components/ConfirmDialog';

const PAGE_SIZE = 10;
const DEFAULT_CPM = 5;

function calendarUrl(c: Campaign) {
  const fmt = (d: string) => new Date(d).toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  const title = encodeURIComponent(`ICON ADS — ${c.name}`);
  const dates = `${fmt(c.startDate)}/${fmt(c.endDate)}`;
  const details = encodeURIComponent(`Campaña publicitaria ICON ADS${c.client ? ` | Cliente: ${c.client.name}` : ''}`);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}`;
}

function daysLeft(endDate: string) {
  return Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000);
}

function DaysLeftBadge({ endDate, active }: { endDate: string; active: boolean }) {
  if (!active) return null;
  const days = daysLeft(endDate);
  if (days < 0) return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300 font-medium">Vencida</span>;
  if (days <= 3) return <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300 font-medium animate-pulse">⚠ {days}d</span>;
  if (days <= 14) return <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300 font-medium">{days}d</span>;
  return <span className="text-xs font-medium" style={{ color: 'var(--text-xs)' }}>{days}d</span>;
}

// #10 — campaign progress timeline
function Timeline({ start, end }: { start: string; end: string }) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  // eslint-disable-next-line react-hooks/purity -- progress bar reads wall-clock time; no React Compiler in use, no SSR of this data
  const now = Date.now();
  const total = endMs - startMs;
  const elapsed = Math.max(0, Math.min(now - startMs, total));
  const pct = total > 0 ? Math.round((elapsed / total) * 100) : 0;
  return (
    <div className="w-full">
      <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-xs)' }}>
        <span>{new Date(start).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}</span>
        <span className="font-medium" style={{ color: 'var(--text-muted)' }}>{pct}%</span>
        <span>{new Date(end).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}</span>
      </div>
      <div className="w-full h-1.5 rounded-full" style={{ background: 'var(--border-md)' }}>
        <div
          className={`h-1.5 rounded-full ${pct >= 100 ? 'bg-red-400' : pct > 75 ? 'bg-amber-400' : 'bg-blue-500'}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [form, setForm] = useState({ clientId: '', name: '', startDate: '', endDate: '', cpm: '', maxImpressions: '', budget: '', observations: '', targetImpressions: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  const [search, setSearch] = useState(() => typeof window !== 'undefined' ? (localStorage.getItem('campaigns_filter_search') ?? '') : '');
  const [page, setPage] = useState(1);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [cloningId, setCloningId] = useState<number | null>(null);
  const [transferTarget, setTransferTarget] = useState<Campaign | null>(null);
  const [transferClientId, setTransferClientId] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [showTemplateSave, setShowTemplateSave] = useState(false);
  const [templateSaveName, setTemplateSaveName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>(() =>
    typeof window !== 'undefined' ? ((localStorage.getItem('campaigns_view') as 'table' | 'cards') ?? 'table') : 'table'
  );

  const load = async () => {
    const [campaignsRes, clientsRes, templatesRes, favsRes] = await Promise.allSettled([
      api.getCampaigns(), api.getClients(), api.getTemplates(), api.getFavorites('campaign'),
    ]);
    if (campaignsRes.status === 'fulfilled') setCampaigns(campaignsRes.value);
    if (clientsRes.status === 'fulfilled') setClients(clientsRes.value);
    if (templatesRes.status === 'fulfilled') setTemplates(templatesRes.value);
    if (favsRes.status === 'fulfilled') setFavorites(favsRes.value);
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount, not a compiler target
  useEffect(() => { load(); }, []);

  const toDateInput = (iso: string) => iso?.slice(0, 10) ?? '';

  // Parse a YYYY-MM-DD string as local midnight to avoid UTC timezone shift
  const parseLocalDate = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).toISOString();
  };

  const filtered = campaigns.filter((c) => {
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || (c.client?.name ?? '').toLowerCase().includes(q);
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openCreate = () => {
    setEditing(null);
    setForm({ clientId: '', name: '', startDate: '', endDate: '', cpm: '', maxImpressions: '', budget: '', observations: '', targetImpressions: '' });
    setError('');
    setShowTemplateSave(false);
    setShowModal(true);
  };
  const openEdit = (c: Campaign) => {
    setEditing(c);
    setForm({ clientId: c.clientId.toString(), name: c.name, startDate: toDateInput(c.startDate), endDate: toDateInput(c.endDate), cpm: c.cpm?.toString() ?? '', maxImpressions: c.maxImpressions?.toString() ?? '', budget: c.budget?.toString() ?? '', observations: c.observations ?? '', targetImpressions: c.targetImpressions?.toString() ?? '' });
    setError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const data = {
        clientId: Number(form.clientId),
        name: form.name,
        startDate: parseLocalDate(form.startDate),
        endDate: parseLocalDate(form.endDate),
        cpm: form.cpm ? Number(form.cpm) : null,
        maxImpressions: form.maxImpressions ? Number(form.maxImpressions) : null,
        budget: form.budget ? Number(form.budget) : null,
        observations: form.observations || null,
        targetImpressions: form.targetImpressions ? Number(form.targetImpressions) : null,
      };
      if (editing) await api.updateCampaign(editing.id, data);
      else await api.createCampaign(data);
      setShowModal(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await api.deleteCampaign(deleteTarget.id).catch(() => {});
    setDeleteTarget(null);
    load();
  };

  // #9 — clone campaign
  const handleClone = async (c: Campaign) => {
    setCloningId(c.id);
    try {
      await api.cloneCampaign(c.id);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error al clonar');
    } finally {
      setCloningId(null);
    }
  };

  // #18 — transfer campaign to another client
  const handleTransfer = async () => {
    if (!transferTarget || !transferClientId) return;
    setTransferring(true);
    try {
      await api.transferCampaign(transferTarget.id, Number(transferClientId));
      setTransferTarget(null);
      setTransferClientId('');
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error al transferir');
    } finally {
      setTransferring(false);
    }
  };

  // #31 — save current form as campaign template
  const handleSaveTemplate = async () => {
    if (!templateSaveName.trim()) return;
    setSavingTemplate(true);
    try {
      await api.createTemplate({
        name: templateSaveName.trim(),
        cpm: form.cpm ? Number(form.cpm) : null,
        maxImpressions: form.maxImpressions ? Number(form.maxImpressions) : null,
        budget: form.budget ? Number(form.budget) : null,
        targetImpressions: form.targetImpressions ? Number(form.targetImpressions) : null,
        observations: form.observations || null,
      });
      setTemplates(await api.getTemplates());
      setShowTemplateSave(false);
    } finally {
      setSavingTemplate(false);
    }
  };

  // #44 — toggle campaign favorite
  const handleToggleFavorite = async (c: Campaign) => {
    const existing = favorites.find((f) => f.entityId === c.id);
    if (existing) {
      await api.removeFavorite(existing.id).catch(() => {});
      setFavorites((prev) => prev.filter((f) => f.id !== existing.id));
    } else {
      const fav = await api.addFavorite('campaign', c.id);
      setFavorites((prev) => [...prev, fav]);
    }
  };

  // #54 — Mercado Pago payment link
  const handleMercadoPago = async (id: number) => {
    try {
      const { initPoint } = await api.getCampaignPaymentLink(id);
      window.open(initPoint, '_blank', 'noopener');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error al generar link MP');
    }
  };

  // #4 — archive all expired campaigns
  const [archivingExpired, setArchivingExpired] = useState(false);
  const handleArchiveExpired = async () => {
    setArchivingExpired(true);
    try {
      const { archived } = await api.archiveExpiredCampaigns();
      if (archived > 0) { load(); } else { alert('No hay campañas vencidas activas.'); }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error');
    } finally { setArchivingExpired(false); }
  };

  // #15 — pause/resume toggle
  const handleToggle = async (c: Campaign) => {
    setTogglingId(c.id);
    try {
      if (c.active) await api.pauseCampaign(c.id);
      else await api.resumeCampaign(c.id);
      load();
    } finally {
      setTogglingId(null);
    }
  };

  const favSet = new Set(favorites.filter((f) => f.entityType === 'campaign').map((f) => f.entityId));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Campañas</h1>
        <div className="flex items-center gap-2">
          {/* #34 — view toggle */}
          <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-md)' }}>
            {(['table', 'cards'] as const).map((m) => (
              <button key={m} onClick={() => { setViewMode(m); localStorage.setItem('campaigns_view', m); }}
                className={`px-2.5 py-1.5 text-sm border-r last:border-0 ${viewMode === m ? 'bg-blue-600 text-white' : ''}`}
                style={{ borderColor: 'var(--border-md)', color: viewMode === m ? 'white' : 'var(--text-muted)' }}
                title={m === 'table' ? 'Vista tabla' : 'Vista tarjetas'}>
                {m === 'table' ? '≡' : '⊞'}
              </button>
            ))}
          </div>
          <button
            onClick={handleArchiveExpired}
            disabled={archivingExpired}
            className="px-4 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
            style={{ borderColor: 'var(--border-md)', color: 'var(--text-muted)' }}
            title="Archivar todas las campañas cuya fecha de fin ya pasó"
          >
            {archivingExpired ? 'Archivando...' : '📁 Archivar vencidas'}
          </button>
          <button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
            + Nueva campaña
          </button>
        </div>
      </div>

      <div className="mb-4">
        <input
          className="input max-w-xs"
          placeholder="Buscar campaña o cliente..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); localStorage.setItem('campaigns_filter_search', e.target.value); setPage(1); }}
        />
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Cargando...</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>{search ? 'Sin resultados.' : 'No hay campañas.'}</p>
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {paged.map((c) => {
            const plays = c._count?.metrics ?? 0;
            const effectiveCpm = c.cpm ?? DEFAULT_CPM;
            const roi = ((plays / 1000) * effectiveCpm).toFixed(2);
            const isFav = favSet.has(c.id);
            return (
              <div key={c.id} className="card p-5">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0 mr-2">
                    <p className="font-semibold text-sm leading-tight truncate">{c.name}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{c.client?.name ?? '—'}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => handleToggleFavorite(c)} className={`text-base leading-none ${isFav ? 'text-amber-400' : 'text-gray-300 hover:text-amber-300'}`}>{isFav ? '★' : '☆'}</button>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'}`}>{c.active ? 'Activa' : 'Pausada'}</span>
                  </div>
                </div>
                <div className="mb-2"><Timeline start={c.startDate} end={c.endDate} /></div>
                <div className="flex items-center justify-between text-xs mb-3">
                  <DaysLeftBadge endDate={c.endDate} active={c.active} />
                  <span className="font-mono" style={{ color: 'var(--text-muted)' }}>${roi}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs border-t pt-2" style={{ borderColor: 'var(--border)' }}>
                  <button onClick={() => handleToggle(c)} disabled={togglingId === c.id} className={`hover:underline disabled:opacity-40 ${c.active ? 'text-amber-600' : 'text-emerald-600'}`}>{togglingId === c.id ? '...' : c.active ? 'Pausar' : 'Reanudar'}</button>
                  <button onClick={() => openEdit(c)} className="text-blue-600 hover:underline">Editar</button>
                  <button onClick={() => handleClone(c)} disabled={cloningId === c.id} className="text-violet-600 hover:underline disabled:opacity-40">{cloningId === c.id ? '...' : 'Clonar'}</button>
                  <a href={calendarUrl(c)} target="_blank" rel="noreferrer" className="text-cyan-600 hover:underline" title="Agregar al Google Calendar">Cal.</a>
                  <a href={api.getCertificateUrl(c.id)} className="text-violet-600 hover:underline">Cert.</a>
                  <a href={api.getContractUrl(c.id)} className="text-emerald-600 hover:underline">Contrato</a>
                  <button onClick={() => setDeleteTarget(c)} className="text-red-500 hover:underline">Eliminar</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ background: 'var(--bg)', borderColor: 'var(--border-md)' }}>
                <th className="text-left px-5 py-3 font-medium" style={{ color: 'var(--text-muted)' }}>Nombre</th>
                <th className="text-left px-5 py-3 font-medium" style={{ color: 'var(--text-muted)' }}>Cliente</th>
                <th className="text-left px-5 py-3 font-medium" style={{ color: 'var(--text-muted)' }}>Progreso</th>
                <th className="text-left px-5 py-3 font-medium" style={{ color: 'var(--text-muted)' }}>Vence</th>
                <th className="text-left px-5 py-3 font-medium" style={{ color: 'var(--text-muted)' }}>Estado</th>
                <th className="text-left px-5 py-3 font-medium" style={{ color: 'var(--text-muted)' }}>ROI est.</th>
                <th className="text-left px-5 py-3 font-medium" style={{ color: 'var(--text-muted)' }}>Editado</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {paged.map((c) => {
                const plays = c._count?.metrics ?? 0;
                const effectiveCpm = c.cpm ?? DEFAULT_CPM;
                const roi = ((plays / 1000) * effectiveCpm).toFixed(2);
                return (
                  <tr key={c.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-5 py-3 font-medium">{c.name}</td>
                    <td className="px-5 py-3" style={{ color: 'var(--text-muted)' }}>{c.client?.name ?? '—'}</td>
                    <td className="px-5 py-3 w-44">
                      <Timeline start={c.startDate} end={c.endDate} />
                    </td>
                    <td className="px-5 py-3">
                      <DaysLeftBadge endDate={c.endDate} active={c.active} />
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                        {c.active ? 'Activa' : 'Pausada'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <div className="font-mono">${roi}</div>
                      {/* #33 — goal progress */}
                      {c.targetImpressions != null && c.targetImpressions > 0 && (() => {
                        const pct = Math.min(100, Math.round((plays / c.targetImpressions) * 100));
                        return (
                          <div className="mt-1">
                            <div className="flex items-center gap-1 mb-0.5">
                              <div className="w-12 h-1 rounded-full" style={{ background: 'var(--border-md)' }}>
                                <div className={`h-1 rounded-full ${pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-blue-500' : 'bg-amber-400'}`} style={{ width: `${pct}%` }} />
                              </div>
                              <span style={{ color: 'var(--text-xs)' }}>{pct}%</span>
                            </div>
                            <div style={{ color: 'var(--text-xs)' }}>{plays.toLocaleString()}/{c.targetImpressions.toLocaleString()} meta</div>
                          </div>
                        );
                      })()}
                      {c.maxImpressions && !c.targetImpressions && (
                        <div className="mt-0.5" style={{ color: 'var(--text-xs)' }}>
                          {plays.toLocaleString()}/{c.maxImpressions.toLocaleString()} imp.
                        </div>
                      )}
                      {/* #7 — budget % executed */}
                      {c.budget != null && c.budget > 0 && (() => {
                        const spent = (plays / 1000) * effectiveCpm;
                        const pct = Math.min(100, Math.round((spent / c.budget) * 100));
                        return (
                          <div className="mt-1">
                            <div className="flex items-center gap-1">
                              <div className="w-12 h-1 rounded-full" style={{ background: 'var(--border-md)' }}>
                                <div className={`h-1 rounded-full ${pct >= 90 ? 'bg-red-500' : pct >= 60 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                              </div>
                              <span style={{ color: 'var(--text-xs)' }}>{pct}%</span>
                            </div>
                            <div style={{ color: 'var(--text-xs)' }}>${spent.toFixed(0)}/${c.budget}</div>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-xs)' }}>
                      {new Date(c.updatedAt).toLocaleDateString('es-AR')}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex gap-2 justify-end items-center">
                        {/* #44 — favorite star */}
                        <button
                          onClick={() => handleToggleFavorite(c)}
                          className={`text-base leading-none ${favSet.has(c.id) ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600 hover:text-amber-300'}`}
                          title={favSet.has(c.id) ? 'Quitar de favoritos' : 'Favorito'}
                        >
                          {favSet.has(c.id) ? '★' : '☆'}
                        </button>
                        <button
                          onClick={() => handleToggle(c)}
                          disabled={togglingId === c.id}
                          className={`text-xs hover:underline disabled:opacity-40 ${c.active ? 'text-amber-600' : 'text-emerald-600'}`}
                        >
                          {togglingId === c.id ? '...' : c.active ? 'Pausar' : 'Reanudar'}
                        </button>
                        {/* #9 — clone campaign */}
                        <button
                          onClick={() => handleClone(c)}
                          disabled={cloningId === c.id}
                          className="text-violet-600 hover:underline text-xs disabled:opacity-40"
                          title="Clonar campaña con todos sus anuncios"
                        >
                          {cloningId === c.id ? '...' : 'Clonar'}
                        </button>
                        {/* #18 — transfer */}
                        <button
                          onClick={() => { setTransferTarget(c); setTransferClientId(''); }}
                          className="text-cyan-600 hover:underline text-xs"
                          title="Transferir a otro cliente"
                        >
                          Transferir
                        </button>
                        <button onClick={() => openEdit(c)} className="text-blue-600 hover:underline text-xs">Editar</button>
                        {/* #60 — Google Calendar link */}
                        <a href={calendarUrl(c)} target="_blank" rel="noreferrer" className="text-cyan-600 hover:underline text-xs" title="Agregar al Google Calendar">Cal.</a>
                        {/* #51 #56 — PDF docs */}
                        <a href={api.getCertificateUrl(c.id)} className="text-violet-600 hover:underline text-xs" title="Certificado de reproducciones PDF">Cert.</a>
                        <a href={api.getContractUrl(c.id)} className="text-emerald-600 hover:underline text-xs" title="Contrato digital PDF">Contrato</a>
                        {/* #54 — Mercado Pago */}
                        {c.budget && <button onClick={() => handleMercadoPago(c.id)} className="text-sky-600 hover:underline text-xs" title="Generar link de pago Mercado Pago">MP Pago</button>}
                        <button onClick={() => setDeleteTarget(c)} className="text-red-500 hover:underline text-xs">Eliminar</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>
          <span>{filtered.length} campañas · página {page} de {totalPages}</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 rounded border disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800" style={{ borderColor: 'var(--border-md)' }}>‹ Anterior</button>
            <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 rounded border disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800" style={{ borderColor: 'var(--border-md)' }}>Siguiente ›</button>
          </div>
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Eliminar campaña"
          message={`¿Eliminar "${deleteTarget.name}"? Los anuncios asociados dejarán de estar disponibles.`}
          confirmLabel="Eliminar"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {showModal && (
        <Modal title={editing ? 'Editar campaña' : 'Nueva campaña'} onClose={() => setShowModal(false)}>
          <div className="space-y-4">
            {/* #31 — template picker (create mode only) */}
            {!editing && templates.length > 0 && (
              <Field label="Cargar plantilla (opcional)">
                <select className="input" defaultValue="" onChange={(e) => {
                  const tpl = templates.find((t) => t.id === Number(e.target.value));
                  if (tpl) setForm((prev) => ({
                    ...prev,
                    cpm: tpl.cpm?.toString() ?? '',
                    maxImpressions: tpl.maxImpressions?.toString() ?? '',
                    budget: tpl.budget?.toString() ?? '',
                    targetImpressions: tpl.targetImpressions?.toString() ?? '',
                    observations: tpl.observations ?? '',
                  }));
                }}>
                  <option value="">Sin plantilla</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Cliente">
              <select className="input" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
                <option value="">Seleccionar cliente</option>
                {clients.filter(c => c.active).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Nombre"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Fecha inicio"><input type="date" className="input" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
            <Field label="Fecha fin"><input type="date" className="input" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
            <Field label="CPM (USD, opcional)"><input type="number" step="0.01" min="0" className="input" value={form.cpm} onChange={(e) => setForm({ ...form, cpm: e.target.value })} placeholder={`${DEFAULT_CPM} (default)`} /></Field>
            <Field label="Límite de impresiones (opcional)">
              <input type="number" step="1" min="1" className="input" value={form.maxImpressions} onChange={(e) => setForm({ ...form, maxImpressions: e.target.value })} placeholder="Sin límite" />
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>La campaña se pausa automáticamente al alcanzar este número.</p>
            </Field>
            {/* #7 — budget */}
            <Field label="Presupuesto total (USD, opcional)">
              <input type="number" step="1" min="0" className="input" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="Sin límite de presupuesto" />
            </Field>
            {/* #33 — target impressions goal */}
            <Field label="Meta de impresiones (opcional)">
              <input type="number" step="1" min="1" className="input" value={form.targetImpressions} onChange={(e) => setForm({ ...form, targetImpressions: e.target.value })} placeholder="Ej: 10000" />
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Objetivo informativo de reproducciones. No pausa la campaña.</p>
            </Field>
            {/* #3 — observations */}
            <Field label="Observaciones internas (opcional)">
              <textarea className="input" rows={2} value={form.observations} onChange={(e) => setForm({ ...form, observations: e.target.value })} placeholder="Notas sobre la campaña, requisitos del cliente, etc." style={{ resize: 'vertical' }} />
            </Field>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            {/* #31 — save as template */}
            <div className="pt-1">
              {!showTemplateSave ? (
                <button onClick={() => { setShowTemplateSave(true); setTemplateSaveName(form.name || 'Plantilla'); }} className="text-xs text-violet-600 hover:underline">
                  + Guardar como plantilla
                </button>
              ) : (
                <div className="flex gap-2 items-center">
                  <input
                    className="input flex-1 text-sm"
                    placeholder="Nombre de la plantilla"
                    value={templateSaveName}
                    onChange={(e) => setTemplateSaveName(e.target.value)}
                  />
                  <button onClick={handleSaveTemplate} disabled={savingTemplate} className="text-xs bg-violet-600 text-white px-3 py-1.5 rounded-lg disabled:bg-violet-400">
                    {savingTemplate ? '...' : 'Guardar'}
                  </button>
                  <button onClick={() => setShowTemplateSave(false)} className="text-xs" style={{ color: 'var(--text-muted)' }}>✕</button>
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={handleSave} disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-2 rounded-lg text-sm font-medium">
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
              <button onClick={() => setShowModal(false)} className="flex-1 border hover:bg-gray-50 dark:hover:bg-gray-800 py-2 rounded-lg text-sm" style={{ borderColor: 'var(--border-md)' }}>
                Cancelar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* #18 — Transfer modal */}
      {transferTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="rounded-xl shadow-xl w-full max-w-sm p-6" style={{ background: 'var(--card)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">Transferir campaña</h2>
              <button onClick={() => setTransferTarget(null)} className="text-xl leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
            </div>
            <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
              Campaña: <span className="font-medium">{transferTarget.name}</span><br />
              Cliente actual: <span className="font-medium">{transferTarget.client?.name ?? '—'}</span>
            </p>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Nuevo cliente</label>
            <select className="input w-full mb-4" value={transferClientId} onChange={(e) => setTransferClientId(e.target.value)}>
              <option value="">Seleccionar cliente...</option>
              {clients.filter((c) => c.active && c.id !== transferTarget.clientId).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={handleTransfer}
                disabled={transferring || !transferClientId}
                className="flex-1 bg-cyan-600 hover:bg-cyan-700 disabled:bg-cyan-400 text-white py-2 rounded-lg text-sm font-medium"
              >
                {transferring ? 'Transfiriendo...' : 'Transferir'}
              </button>
              <button onClick={() => setTransferTarget(null)} className="flex-1 border py-2 rounded-lg text-sm" style={{ borderColor: 'var(--border-md)' }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="rounded-xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" style={{ background: 'var(--card)' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg">{title}</h2>
          <button onClick={onClose} className="text-xl leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{label}</label>
      {children}
    </div>
  );
}
