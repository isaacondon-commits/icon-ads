// Íconos de línea chicos para botones y acciones.

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
