'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';

const links = [
  { href: '/dashboard', label: 'Dashboard', icon: '⊞' },
  { href: '/monitor', label: 'Monitor', icon: '◎' },
  { href: '/tablets', label: 'Tablets', icon: '⊡' },
  { href: '/clients', label: 'Clientes', icon: '⊛' },
  { href: '/campaigns', label: 'Campañas', icon: '◈' },
  { href: '/ads', label: 'Anuncios', icon: '◉' },
  { href: '/playlists', label: 'Playlists', icon: '≡' },
  { href: '/calendar', label: 'Calendario', icon: '▦' },
  { href: '/stats', label: 'Estadísticas', icon: '◫' },
  { href: '/logs', label: 'Logs', icon: '☰' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();

  return (
    <aside
      className="w-60 min-h-screen flex flex-col transition-colors duration-200"
      style={{ background: 'var(--sidebar)' }}
    >
      <div className="px-6 py-5 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-sm text-white">
            IA
          </div>
          <div>
            <p className="font-semibold text-sm text-white">Icon Ads</p>
            <p className="text-xs text-gray-400">Panel admin</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {links.map((link) => {
          const active = pathname === link.href || pathname.startsWith(link.href + '/');
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                active ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
              style={!active ? { ['--hover-bg' as string]: 'var(--sidebar-hover)' } : undefined}
              onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--sidebar-hover)'; }}
              onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = ''; }}
            >
              <span className="text-base">{link.icon}</span>
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-gray-800 space-y-1">
        {/* Dark mode toggle (#1) */}
        <button
          onClick={toggle}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
          style={{}}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sidebar-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '')}
        >
          <span>{theme === 'dark' ? '☀' : '☾'}</span>
          {theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
        </button>
        <div className="px-3 py-2">
          <p className="text-xs font-medium text-white truncate">{user?.name}</p>
          <p className="text-xs text-gray-500 truncate">{user?.email}</p>
          {user?.role && (
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium mt-1 inline-block ${
              user.role === 'superadmin' ? 'bg-violet-900 text-violet-200' : 'bg-gray-800 text-gray-400'
            }`}>
              {user.role}
            </span>
          )}
        </div>
        <button
          onClick={logout}
          className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sidebar-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '')}
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
