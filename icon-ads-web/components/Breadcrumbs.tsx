'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LABELS: Record<string, string> = {
  dashboard: 'Atajos', tablets: 'Tablets', clients: 'Clientes',
  ads: 'Anuncios', playlists: 'Playlists', stats: 'Estadísticas', monitor: 'Monitor',
  logs: 'Logs', calendar: 'Calendario', compare: 'Comparar',
  maintenance: 'Mantenimiento', orden: 'Órdenes',
};

export default function Breadcrumbs() {
  const path = usePathname();
  const parts = path.split('/').filter(Boolean);

  if (parts.length <= 1) return null;

  // /tablets ya no es una página: el tramo 'Tablets' lleva al Monitor.
  const crumbs = parts.map((part, i) => ({
    label: i === 0 && part === 'tablets' ? 'Monitor' : LABELS[part] ?? (isNaN(Number(part)) ? part : `#${part}`),
    // /maintenance/orden tampoco es una página: lleva a la pestaña Órdenes.
    href: i === 0 && part === 'tablets' ? '/monitor'
      : parts[0] === 'maintenance' && part === 'orden' ? '/maintenance?tab=ordenes'
        : '/' + parts.slice(0, i + 1).join('/'),
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
