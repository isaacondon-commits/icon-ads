'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LABELS: Record<string, string> = {
  dashboard: 'Dashboard', tablets: 'Tablets', campaigns: 'Campañas', clients: 'Clientes',
  ads: 'Anuncios', playlists: 'Playlists', stats: 'Estadísticas', monitor: 'Monitor',
  logs: 'Logs', calendar: 'Calendario',
};

export default function Breadcrumbs() {
  const path = usePathname();
  const parts = path.split('/').filter(Boolean);

  if (parts.length <= 1) return null;

  const crumbs = parts.map((part, i) => ({
    label: LABELS[part] ?? (isNaN(Number(part)) ? part : `#${part}`),
    href: '/' + parts.slice(0, i + 1).join('/'),
    isLast: i === parts.length - 1,
  }));

  return (
    <nav className="flex items-center gap-1 text-xs mb-5" style={{ color: 'var(--text-muted)' }}>
      <Link href="/dashboard" className="hover:underline">Inicio</Link>
      {crumbs.map((c) => (
        <span key={c.href} className="flex items-center gap-1">
          <span className="opacity-40">/</span>
          {c.isLast ? (
            <span style={{ color: 'var(--text)' }}>{c.label}</span>
          ) : (
            <Link href={c.href} className="hover:underline">{c.label}</Link>
          )}
        </span>
      ))}
    </nav>
  );
}
