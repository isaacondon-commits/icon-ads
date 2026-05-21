'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { api, Notifications } from '@/lib/api';

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
  { href: '/archive', label: 'Archivo', icon: '⊗' },
  { href: '/logs', label: 'Logs', icon: '☰' },
  { href: '/groups', label: 'Grupos', icon: '⊞' },
  { href: '/tablets/compare', label: 'Comparar tablets', icon: '⊟' },
  { href: '/settings', label: 'Configuración', icon: '⚙' },
  { href: '/profile', label: 'Perfil', icon: '◷' },
  { href: '/help', label: 'Ayuda', icon: '?' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [pendingAds, setPendingAds] = useState(0);
  const [notifications, setNotifications] = useState<Notifications | null>(null);
  const [showNotif, setShowNotif] = useState(false);

  useEffect(() => {
    const fetchNotifs = () => {
      api.getPendingAdsCount().then((r) => setPendingAds(r.count)).catch(() => {});
      api.getNotifications().then(setNotifications).catch(() => {});
    };
    fetchNotifs();
    const id = setInterval(fetchNotifs, 5 * 60_000);
    return () => clearInterval(id);
  }, []);

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
          const badge = link.href === '/ads' && pendingAds > 0 ? pendingAds : null;
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
              <span className="flex-1">{link.label}</span>
              {badge && (
                <span className="text-xs font-bold bg-red-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-gray-800 space-y-1">
        {/* #26 — Notification bell */}
        <div className="relative">
          <button
            onClick={() => setShowNotif((s) => !s)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sidebar-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '')}
          >
            <span>🔔</span>
            <span className="flex-1">Notificaciones</span>
            {notifications && notifications.total > 0 && (
              <span className="text-xs font-bold bg-red-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {notifications.total > 99 ? '99+' : notifications.total}
              </span>
            )}
          </button>
          {showNotif && notifications && (
            <div
              className="absolute bottom-full left-0 right-0 mb-1 rounded-xl shadow-xl border z-50 overflow-hidden"
              style={{ background: 'var(--card)', borderColor: 'var(--border-md)' }}
            >
              <div className="px-3 py-2 border-b text-xs font-semibold" style={{ borderColor: 'var(--border-md)', color: 'var(--text-muted)' }}>
                ALERTAS
              </div>
              {notifications.total === 0 ? (
                <p className="px-3 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>Sin alertas activas</p>
              ) : (
                <div className="max-h-64 overflow-y-auto">
                  {notifications.pendingAds > 0 && (
                    <Link href="/ads" onClick={() => setShowNotif(false)} className="flex items-start gap-2 px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-950/20 border-b" style={{ borderColor: 'var(--border)' }}>
                      <span className="text-amber-500 shrink-0">⏳</span>
                      <span className="text-xs">{notifications.pendingAds} anuncio{notifications.pendingAds !== 1 ? 's' : ''} pendiente{notifications.pendingAds !== 1 ? 's' : ''} de aprobación</span>
                    </Link>
                  )}
                  {notifications.expiringCampaigns.map((c) => (
                    <Link href="/campaigns" key={c.id} onClick={() => setShowNotif(false)} className="flex items-start gap-2 px-3 py-2 hover:bg-red-50 dark:hover:bg-red-950/20 border-b" style={{ borderColor: 'var(--border)' }}>
                      <span className="text-red-500 shrink-0">⏰</span>
                      <span className="text-xs">{c.name} vence en {c.daysLeft}d</span>
                    </Link>
                  ))}
                  {notifications.offlineTablets.map((t) => (
                    <Link href="/monitor" key={t.id} onClick={() => setShowNotif(false)} className="flex items-start gap-2 px-3 py-2 hover:bg-orange-50 dark:hover:bg-orange-950/20 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                      <span className="text-orange-500 shrink-0">📵</span>
                      <span className="text-xs">{t.name} offline {t.offlineMinutes != null ? `${Math.floor(t.offlineMinutes / 60)}h ${t.offlineMinutes % 60}m` : ''}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

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
