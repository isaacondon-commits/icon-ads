'use client';

import { useEffect, useState } from 'react';
import { Ad, BASE } from '@/lib/api';
import { Icon } from '@/components/CampaignActions';

// Piezas de la página de Anuncios: fila de lista, tarjeta de grilla y el visor
// "Ver anuncio". Toda la info de entrega (reproducciones, playlists, motivo por
// el que no pasa) viene calculada del backend en `ad.delivery`.

export const mediaUrl = (fileUrl: string) => (fileUrl.startsWith('http') ? fileUrl : `${BASE}${fileUrl}`);

export function hasNoCampaign(ad: Ad) {
  return ad.delivery?.issue?.code === 'no_campaign' || !ad.campaign || !!ad.campaign.deletedAt;
}

/** Aprobado y nunca reproducido en ninguna tablet. */
export function neverPlayed(ad: Ad) {
  return ad.approvalStatus === 'approved' && (ad.delivery?.plays ?? 0) === 0;
}

function formatBytes(bytes?: number | null) {
  if (!bytes) return null;
  const MB = 1024 * 1024;
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(2)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `hace ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

function Thumb({ ad, className, hoverPlay }: { ad: Ad; className: string; hoverPlay?: boolean }) {
  const [hover, setHover] = useState(false);
  return (
    <div className={`relative overflow-hidden bg-gray-900 ${className}`}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {ad.type === 'image' ? (
        <img src={mediaUrl(ad.fileUrl)} alt="" className="h-full w-full object-cover" />
      ) : hoverPlay && hover ? (
        <video src={mediaUrl(ad.fileUrl)} className="h-full w-full object-cover" muted autoPlay loop playsInline />
      ) : ad.thumbnailUrl ? (
        <img src={mediaUrl(ad.thumbnailUrl)} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full flex items-center justify-center text-gray-400"><Icon name="play" className="w-6 h-6" /></div>
      )}
      {ad.type === 'video' && (
        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] font-medium text-white tabular-nums">{ad.durationS}s</span>
      )}
    </div>
  );
}

function CampaignLabel({ ad }: { ad: Ad }) {
  if (hasNoCampaign(ad)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300"
        title={ad.campaign?.deletedAt ? `La campaña "${ad.campaign.name}" está archivada` : undefined}>
        Sin campaña
      </span>
    );
  }
  return <span className="truncate" style={{ color: 'var(--text-muted)' }}>{ad.campaign?.name}</span>;
}

function StatusBadge({ ad }: { ad: Ad }) {
  const map = {
    pending: ['Pendiente', 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'],
    rejected: ['Rechazado', 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'],
    paused: ['Pausado', 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300'],
    live: ['Activo', 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'],
  } as const;
  const key = ad.approvalStatus === 'pending' ? 'pending'
    : ad.approvalStatus === 'rejected' ? 'rejected'
      : !ad.active ? 'paused' : 'live';
  const [label, cls] = map[key];
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

/** Reproducciones + aviso si nunca pasó / por qué no pasa. */
function DeliveryInfo({ ad }: { ad: Ad }) {
  const d = ad.delivery;
  if (!d) return null;
  const issue = d.issue;
  return (
    <div className="min-w-0 text-xs">
      {d.plays > 0 ? (
        <p>
          <span className="font-semibold tabular-nums">{d.plays.toLocaleString('es-AR')}</span>
          <span style={{ color: 'var(--text-muted)' }}> reproducciones</span>
          {d.lastPlayedAt && <span style={{ color: 'var(--text-xs)' }}> · última {timeAgo(d.lastPlayedAt)}</span>}
        </p>
      ) : ad.approvalStatus === 'approved' ? (
        <p className="font-semibold text-red-600 dark:text-red-400">⚠ Nunca se reprodujo</p>
      ) : (
        <p style={{ color: 'var(--text-xs)' }}>Sin reproducciones</p>
      )}
      {issue && issue.code !== 'no_campaign' ? (
        <p className={`mt-0.5 truncate ${issue.level === 'error' ? 'text-red-600 dark:text-red-400' : ''}`}
          style={issue.level === 'info' ? { color: 'var(--text-muted)' } : undefined} title={issue.label}>
          {issue.level === 'error' ? 'No pasa: ' : ''}{issue.label}
        </p>
      ) : !issue ? (
        <p className="mt-0.5 truncate" style={{ color: 'var(--text-xs)' }}>
          {d.playlists.length} playlist{d.playlists.length === 1 ? '' : 's'} · {d.tablets} tablet{d.tablets === 1 ? '' : 's'}
        </p>
      ) : null}
    </div>
  );
}

export type AdActionHandlers = {
  canManage: boolean;
  busyId: number | null;
  onView: (ad: Ad) => void;
  onApprove: (ad: Ad) => void;
  onReject: (ad: Ad) => void;
  onTogglePause: (ad: Ad) => void;
  onEdit: (ad: Ad) => void;
  onDelete: (ad: Ad) => void;
  onTag: (tag: string) => void;
};

const btn = 'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-40';
const btnNeutral = `${btn} text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700`;
const iconBtn = 'inline-flex items-center justify-center h-7 w-7 rounded-md border transition-colors disabled:opacity-40';

function ViewButton({ ad, onView }: { ad: Ad; onView: (ad: Ad) => void }) {
  return (
    <button type="button" onClick={() => onView(ad)}
      className={`${btn} border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50`}>
      <Icon name="play" />
      Ver anuncio
    </button>
  );
}

function ManageButtons({ ad, h }: { ad: Ad; h: AdActionHandlers }) {
  if (!h.canManage) return null;
  const busy = h.busyId === ad.id;
  return (
    <>
      {ad.approvalStatus === 'pending' && (
        <>
          <button type="button" onClick={() => h.onApprove(ad)} disabled={busy}
            className={`${btn} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300`}>
            Aprobar
          </button>
          <button type="button" onClick={() => h.onReject(ad)} disabled={busy} className={btnNeutral} style={{ borderColor: 'var(--border-md)' }}>
            Rechazar
          </button>
        </>
      )}
      {ad.approvalStatus === 'approved' && (
        <button type="button" onClick={() => h.onTogglePause(ad)} disabled={busy} title={ad.active ? 'Pausar' : 'Reanudar'}
          className={`${iconBtn} ${ad.active ? 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30' : 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30'}`}
          style={{ borderColor: 'var(--border-md)' }}>
          <Icon name={ad.active ? 'pause' : 'play'} />
        </button>
      )}
      <button type="button" onClick={() => h.onEdit(ad)} title="Editar"
        className={`${iconBtn} text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700`} style={{ borderColor: 'var(--border-md)' }}>
        <Icon name="edit" />
      </button>
      <button type="button" onClick={() => h.onDelete(ad)} title="Eliminar"
        className={`${iconBtn} text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30`} style={{ borderColor: 'var(--border-md)' }}>
        <Icon name="trash" />
      </button>
    </>
  );
}

function Tags({ ad, onTag }: { ad: Ad; onTag: (t: string) => void }) {
  if (!(ad.tags ?? []).length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {ad.tags.map((t) => (
        <button key={t} type="button" onClick={() => onTag(t)}
          className="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">{t}</button>
      ))}
    </div>
  );
}

/** Lista: una fila por anuncio. */
export function AdList({ ads, h }: { ads: Ad[]; h: AdActionHandlers }) {
  return (
    <ul className="card divide-y overflow-hidden" style={{ borderColor: 'var(--border-md)' }}>
      {ads.map((ad) => {
        const warn = hasNoCampaign(ad) || neverPlayed(ad);
        return (
          <li key={ad.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 ${warn ? 'border-l-4 border-l-red-400' : 'border-l-4 border-l-transparent'}`}
            style={{ borderTopColor: 'var(--border)' }}>
            <button type="button" onClick={() => h.onView(ad)} className="shrink-0 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" title="Ver anuncio">
              <Thumb ad={ad} className="h-14 w-24 rounded-md" hoverPlay />
            </button>
            <div className="min-w-0 flex-1 basis-56">
              <div className="flex items-center gap-2">
                <p className="truncate font-medium">{ad.name}</p>
                <StatusBadge ad={ad} />
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
                <CampaignLabel ad={ad} />
                <span style={{ color: 'var(--text-xs)' }}>
                  · {ad.type === 'video' ? 'Video' : 'Imagen'} · {ad.durationS}s{formatBytes(ad.fileSize) ? ` · ${formatBytes(ad.fileSize)}` : ''}
                </span>
              </div>
              <div className="mt-1"><Tags ad={ad} onTag={h.onTag} /></div>
            </div>
            <div className="w-56 shrink-0"><DeliveryInfo ad={ad} /></div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <ViewButton ad={ad} onView={h.onView} />
              <ManageButtons ad={ad} h={h} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Grilla: tarjetas con miniatura grande. */
export function AdGrid({ ads, h }: { ads: Ad[]; h: AdActionHandlers }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {ads.map((ad) => (
        <div key={ad.id} className={`card overflow-hidden ${hasNoCampaign(ad) || neverPlayed(ad) ? 'ring-1 ring-red-300 dark:ring-red-800' : ''}`}>
          <button type="button" onClick={() => h.onView(ad)} className="block w-full" title="Ver anuncio">
            <Thumb ad={ad} className="h-36 w-full" hoverPlay />
          </button>
          <div className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-sm font-medium">{ad.name}</p>
              <StatusBadge ad={ad} />
            </div>
            <div className="flex min-w-0 items-center gap-1.5 text-xs"><CampaignLabel ad={ad} /></div>
            <DeliveryInfo ad={ad} />
            <Tags ad={ad} onTag={h.onTag} />
            <div className="flex flex-wrap items-center gap-1.5 border-t pt-3" style={{ borderColor: 'var(--border-md)' }}>
              <ViewButton ad={ad} onView={h.onView} />
              <div className="ml-auto flex items-center gap-1.5"><ManageButtons ad={ad} h={h} /></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <span style={{ color: 'var(--text-muted)' }}>{k}</span>
      <span className="text-right font-medium">{v}</span>
    </div>
  );
}

/** Visor "Ver anuncio": el archivo en grande + datos de entrega. */
export function AdViewer({ ad, onClose }: { ad: Ad; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const d = ad.delivery;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div role="dialog" aria-label={`Anuncio ${ad.name}`} onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl lg:flex-row" style={{ background: 'var(--card)' }}>
        <div className="flex flex-1 items-center justify-center bg-black lg:min-h-[420px]">
          {ad.type === 'image' ? (
            <img src={mediaUrl(ad.fileUrl)} alt={ad.name} className="max-h-[60vh] w-full object-contain lg:max-h-[88vh]" />
          ) : (
            <video src={mediaUrl(ad.fileUrl)} controls autoPlay muted playsInline className="max-h-[60vh] w-full lg:max-h-[88vh]" />
          )}
        </div>
        <div className="w-full shrink-0 overflow-y-auto p-5 lg:w-80">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold leading-tight">{ad.name}</h2>
              <div className="mt-1 flex items-center gap-1.5 text-sm"><CampaignLabel ad={ad} /></div>
            </div>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="text-2xl leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
          </div>
          {d?.issue && (
            <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${d.issue.level === 'error'
              ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
              : 'bg-gray-100 dark:bg-slate-800'}`}>
              {d.issue.level === 'error' ? '⚠ No se está reproduciendo: ' : ''}{d.issue.label}
            </div>
          )}
          <div className="divide-y" style={{ borderColor: 'var(--border-md)' }}>
            <Row k="Estado" v={<StatusBadge ad={ad} />} />
            <Row k="Tipo" v={ad.type === 'video' ? 'Video' : 'Imagen'} />
            <Row k="Duración" v={`${ad.durationS} s`} />
            {formatBytes(ad.fileSize) && <Row k="Peso" v={formatBytes(ad.fileSize)} />}
            <Row k="Reproducciones" v={d ? (d.plays > 0 ? d.plays.toLocaleString('es-AR') : <span className="text-red-600 dark:text-red-400">Nunca</span>) : '—'} />
            {d?.lastPlayedAt && <Row k="Última vez" v={timeAgo(d.lastPlayedAt)} />}
            <Row k="Subido" v={new Date(ad.createdAt).toLocaleDateString('es-AR')} />
          </div>
          {d && (
            <div className="mt-4">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Playlists</p>
              {d.playlists.length ? (
                <ul className="space-y-1 text-sm">
                  {d.playlists.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2">
                      <span className="truncate">{p.name}</span>
                      <span className={p.tablets ? '' : 'text-red-600 dark:text-red-400'} style={p.tablets ? { color: 'var(--text-muted)' } : undefined}>
                        {p.tablets} tablet{p.tablets === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-red-600 dark:text-red-400">No está en ninguna playlist.</p>}
            </div>
          )}
          <a href={mediaUrl(ad.fileUrl)} target="_blank" rel="noreferrer" className="mt-5 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400">
            Abrir archivo original ↗
          </a>
        </div>
      </div>
    </div>
  );
}
