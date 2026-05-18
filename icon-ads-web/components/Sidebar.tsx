'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

const links = [
  { href: '/dashboard', label: 'Dashboard', icon: '⊞' },
  { href: '/monitor', label: 'Monitor', icon: '◎' },
  { href: '/tablets', label: 'Tablets', icon: '⊡' },
  { href: '/clients', label: 'Clientes', icon: '⊛' },
  { href: '/campaigns', label: 'Campañas', icon: '◈' },
  { href: '/ads', label: 'Anuncios', icon: '◉' },
  { href: '/playlists', label: 'Playlists', icon: '≡' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <aside className="w-60 min-h-screen bg-gray-900 text-white flex flex-col">
      <div className="px-6 py-5 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-sm">
            IA
          </div>
          <div>
            <p className="font-semibold text-sm">Icon Ads</p>
            <p className="text-xs text-gray-400">Panel admin</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              <span className="text-base">{link.icon}</span>
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-gray-800">
        <div className="px-3 py-2 mb-1">
          <p className="text-xs font-medium text-white truncate">{user?.name}</p>
          <p className="text-xs text-gray-500 truncate">{user?.email}</p>
        </div>
        <button
          onClick={logout}
          className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
