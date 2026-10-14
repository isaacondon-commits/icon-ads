'use client';

import { useEffect, useRef, useState } from 'react';
import { VARIANT } from '@/components/ui/buttons';

// Barra de acciones de una campaña: las dos acciones de todos los días a la
// vista (Pausar/Reanudar y Editar) y el resto en un menú "Más". El menú se
// posiciona `fixed` para que no lo recorte el scroll horizontal de la tabla.

type IconName = 'pause' | 'play' | 'edit' | 'more' | 'copy' | 'transfer' | 'calendar' | 'cert' | 'contract' | 'pay' | 'trash';

const PATHS: Record<IconName, string> = {
  pause: 'M7 5h3v14H7zM14 5h3v14h-3z',
  play: 'M7 4.5v15l12-7.5z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  transfer: 'M4 8h13l-3-3M20 16H7l3 3',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  cert: 'M12 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM9.5 14.5 8 21l4-2 4 2-1.5-6.5',
  contract: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
  pay: 'M3 7h18v10H3zM3 11h18M7 15h3',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
};

export function Icon({ name, className = 'w-3.5 h-3.5' }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 3 : 1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

type Tone = 'neutral' | 'amber' | 'emerald' | 'blue';
const TONES: Record<Tone, string> = {
  neutral: VARIANT.neutral,
  amber: VARIANT.warn,
  emerald: VARIANT.ok,
  blue: VARIANT.accent,
};

function PillButton({ icon, label, tone = 'neutral', onClick, disabled, title }: {
  icon: IconName; label: string; tone?: Tone; onClick: () => void; disabled?: boolean; title?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${TONES[tone]}`}>
      <Icon name={icon} />
      {label}
    </button>
  );
}

export type MenuItem =
  | { kind: 'action'; icon: IconName; label: string; onClick: () => void; danger?: boolean; hint?: string }
  | { kind: 'link'; icon: IconName; label: string; href: string; external?: boolean; hint?: string }
  | { kind: 'separator' };

function MoreMenu({ items }: { items: MenuItem[] }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pos) return;
    const close = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type === 'mousedown' && (menuRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node))) return;
      setPos(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pos]);

  const toggle = () => {
    if (pos) { setPos(null); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    // Abre hacia arriba si no entra abajo (~300 px de menú).
    const top = r.bottom + 300 > window.innerHeight ? Math.max(8, r.top - 304) : r.bottom + 4;
    setPos({ top, right: Math.max(8, window.innerWidth - r.right) });
  };

  const itemCls = 'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors';
  return (
    <>
      <button ref={btnRef} type="button" onClick={toggle} title="Más acciones" aria-haspopup="menu" aria-expanded={!!pos}
        className={`inline-flex items-center justify-center h-8 w-8 rounded-full border transition-colors ${TONES.neutral} ${pos ? 'bg-[var(--surface-hover)]' : ''}`}>
        <Icon name="more" className="w-4 h-4" />
      </button>
      {pos && (
        <div ref={menuRef} role="menu" className="fixed z-50 w-60 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] shadow-2xl"
          style={{ top: pos.top, right: pos.right }}>
          {items.map((it, i) => {
            if (it.kind === 'separator') return <div key={i} className="my-1 border-t" style={{ borderColor: 'var(--border-md)' }} />;
            const content = (
              <>
                <Icon name={it.icon} className="w-4 h-4 shrink-0 opacity-70" />
                <span className="flex-1">{it.label}</span>
                {it.hint && <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-xs)' }}>{it.hint}</span>}
              </>
            );
            if (it.kind === 'link') {
              return (
                <a key={i} role="menuitem" href={it.href} onClick={() => setPos(null)}
                  {...(it.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                  className={`${itemCls} hover:bg-gray-100 dark:hover:bg-slate-700`}>
                  {content}
                </a>
              );
            }
            return (
              <button key={i} role="menuitem" type="button" onClick={() => { setPos(null); it.onClick(); }}
                className={`${itemCls} ${it.danger ? 'text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]' : 'text-[var(--text)] hover:bg-[var(--surface-hover)]'}`}>
                {content}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function CampaignActions({
  active, expired, canManage, busyToggle, busyClone,
  onToggle, onEdit, onClone, onTransfer, onDelete, onPay,
  calendarHref, certificateHref, contractHref,
}: {
  active: boolean; expired: boolean; canManage: boolean; busyToggle: boolean; busyClone: boolean;
  onToggle: () => void; onEdit: () => void; onClone: () => void; onTransfer: () => void; onDelete: () => void;
  onPay?: () => void;
  calendarHref: string; certificateHref: string; contractHref: string;
}) {
  const items: MenuItem[] = [];
  if (canManage) {
    items.push({ kind: 'action', icon: 'copy', label: busyClone ? 'Clonando…' : 'Clonar campaña', onClick: onClone });
    items.push({ kind: 'action', icon: 'transfer', label: 'Transferir a otro cliente', onClick: onTransfer });
    items.push({ kind: 'separator' });
  }
  items.push({ kind: 'link', icon: 'calendar', label: 'Agregar a Google Calendar', href: calendarHref, external: true });
  items.push({ kind: 'link', icon: 'cert', label: 'Certificado de emisión', href: certificateHref, hint: 'PDF' });
  items.push({ kind: 'link', icon: 'contract', label: 'Contrato', href: contractHref, hint: 'PDF' });
  if (onPay) items.push({ kind: 'action', icon: 'pay', label: 'Link de pago Mercado Pago', onClick: onPay });
  if (canManage) {
    items.push({ kind: 'separator' });
    items.push({ kind: 'action', icon: 'trash', label: 'Eliminar campaña', onClick: onDelete, danger: true });
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {canManage && (expired ? (
        <PillButton icon="edit" label="Extender" tone="blue" onClick={onEdit} title="La campaña venció: extendé la fecha de fin para volver a pasarla" />
      ) : (
        <PillButton icon={active ? 'pause' : 'play'} label={busyToggle ? '…' : active ? 'Pausar' : 'Reanudar'}
          tone={active ? 'amber' : 'emerald'} onClick={onToggle} disabled={busyToggle} />
      ))}
      {canManage && !expired && <PillButton icon="edit" label="Editar" onClick={onEdit} />}
      <MoreMenu items={items} />
    </div>
  );
}
