'use client';

import Link from 'next/link';

// Botones y pestañas con la paleta ICON (mismo estilo que el Monitor).

export const ICONS = {
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4.5v15l12-7.5z',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  transfer: 'M4 8h13l-3-3M20 16H7l3 3',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  file: 'M6 3h9l4 4v14H6zM14 3v5h5',
  pay: 'M3 7h18v10H3zM3 11h18M7 15h3',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  check: 'M5 12l5 5L20 7',
  x: 'M6 6l12 12M18 6 6 18',
  power: 'M12 3v8M6.3 7.3a8 8 0 1 0 11.4 0',
  sync: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  unlock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  warn: 'M12 4 2.5 20h19zM12 10v4M12 17h.01',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
} as const;
export type IconName = keyof typeof ICONS;

export function Ico({ name, className = 'h-4 w-4' }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 3 : 1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export const VARIANT = {
  neutral: 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-hover)]',
  primary: 'border-[var(--accent-strong)] bg-[var(--accent-strong)] text-white hover:bg-[var(--accent-hover)] hover:border-[var(--accent-hover)]',
  accent: 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_16%,transparent)]',
  danger: 'border-[var(--danger-border)] bg-transparent text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]',
  ok: 'border-[color-mix(in_srgb,var(--ok)_40%,transparent)] bg-[color-mix(in_srgb,var(--ok)_10%,transparent)] text-[var(--ok)] hover:bg-[color-mix(in_srgb,var(--ok)_18%,transparent)]',
  warn: 'border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] text-[var(--warn)] hover:bg-[color-mix(in_srgb,var(--warn)_18%,transparent)]',
  ghost: 'border-transparent bg-transparent text-[var(--accent)] hover:bg-[var(--surface-hover)]',
} as const;
export type Variant = keyof typeof VARIANT;

const SIZE = {
  md: 'h-10 px-4 text-sm gap-2',
  sm: 'h-8 px-3 text-xs gap-1.5',
} as const;

export const btnClass = (v: Variant = 'neutral', size: keyof typeof SIZE = 'md') =>
  `inline-flex items-center rounded-full border font-medium whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${SIZE[size]} ${VARIANT[v]}`;

export function Btn({ icon, v = 'neutral', size = 'md', onClick, disabled, title, type = 'button', children }: {
  icon?: IconName; v?: Variant; size?: keyof typeof SIZE; onClick?: () => void; disabled?: boolean; title?: string;
  type?: 'button' | 'submit'; children: React.ReactNode;
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={btnClass(v, size)}>
      {icon && <Ico name={icon} className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
      {children}
    </button>
  );
}

export function BtnLink({ href, icon, v = 'neutral', size = 'md', external, children }: {
  href: string; icon?: IconName; v?: Variant; size?: keyof typeof SIZE; external?: boolean; children: React.ReactNode;
}) {
  const cls = btnClass(v, size);
  const inner = <>{icon && <Ico name={icon} className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}{children}</>;
  if (external || href.startsWith('http')) return <a href={href} target={external ? '_blank' : undefined} rel="noreferrer" className={cls}>{inner}</a>;
  return <Link href={href} className={cls}>{inner}</Link>;
}

// Botón redondo de ícono con el nombre al pasar el mouse.
export function IconBtn({ icon, label, v = 'neutral', onClick, disabled, href }: {
  icon: IconName; label: string; v?: Variant; onClick?: () => void; disabled?: boolean; href?: string;
}) {
  const cls = `inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors disabled:opacity-40 ${VARIANT[v]}`;
  return (
    <span className="group/ib relative inline-flex">
      {href ? (
        <a href={href} aria-label={label} className={cls}><Ico name={icon} /></a>
      ) : (
        <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className={cls}><Ico name={icon} /></button>
      )}
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-xs text-[var(--text)] shadow-lg group-hover/ib:block">
        {label}
      </span>
    </span>
  );
}

// Pestaña tipo píldora: activa en azul fuerte; las de alerta en rojo.
export function TabPill({ active, alert, onClick, children, count }: {
  active: boolean; alert?: boolean; onClick: () => void; children: React.ReactNode; count?: number;
}) {
  const cls = active && !alert ? 'border-[var(--accent-strong)] bg-[var(--accent-strong)] text-white'
    : alert ? `border-[var(--danger-border)] text-[var(--danger)] ${active ? 'bg-[color-mix(in_srgb,var(--danger)_14%,transparent)]' : 'hover:bg-[color-mix(in_srgb,var(--danger)_8%,transparent)]'}`
      : 'border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-hover)]';
  return (
    <button type="button" onClick={onClick} className={`inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors ${cls}`}>
      {alert && <Ico name="warn" className="h-4 w-4" />}
      {children}
      {count != null && <span className={active && !alert ? 'text-white/80' : alert ? '' : 'text-[var(--muted)]'}>{count}</span>}
    </button>
  );
}

// Selector de vista lista/grilla con íconos.
export function ViewToggle({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: { value: string; icon: IconName; label: string }[];
}) {
  return (
    <div className="inline-flex h-10 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface)]">
      {options.map((o) => (
        <button key={o.value} type="button" title={o.label} aria-label={o.label} onClick={() => onChange(o.value)}
          className={`px-3 transition-colors ${value === o.value ? 'bg-[var(--accent-strong)] text-white' : 'text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]'}`}>
          <Ico name={o.icon} />
        </button>
      ))}
    </div>
  );
}
