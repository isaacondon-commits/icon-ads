'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useRole } from '@/lib/roles';
import { api, Notifications } from '@/lib/api';

const SEV_ICON: Record<string, string> = { critical: '🚨', warning: '⚠️', info: 'ℹ️' };

// Íconos de línea por sección (paleta-propuesta). Si una ruta no tiene, se usa
// el genérico.
const NAV_ICONS: Record<string, string> = {
  '/dashboard': 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  '/monitor': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  '/map': 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  '/clients': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  '/ads': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  '/playlists': 'M4 6h16M4 12h16M4 18h16',
  '/tablets/compare': 'M3 6h18v12H3zM3 12h18',
  '/apk': 'M12 4v12M7 11l5 5 5-5M5 20h14',
  '/maintenance': 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  '/stats': 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  '/logs': 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
  '/calendar': 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  '/settings': 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  '/profile': 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
};
const NAV_ICON_DEFAULT = 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z';

function NavIcon({ href }: { href: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={NAV_ICONS[href] ?? NAV_ICON_DEFAULT} />
    </svg>
  );
}

// Secciones que sólo ve un admin/superadmin (supervisor y operator no).
const ADMIN_ONLY_HREFS = new Set(['/settings', '/apk']);

const linkGroups = [
  {
    id: 'principal', label: 'Principal', links: [
      { href: '/dashboard', label: 'Atajos', icon: '⊞' },
      { href: '/monitor', label: 'Monitor', icon: '◎' },
      { href: '/map', label: 'Mapa GPS', icon: '◉' },
    ],
  },
  {
    id: 'publicidad', label: 'Publicidad', links: [
      { href: '/clients', label: 'Clientes', icon: '⊛' },
      { href: '/ads', label: 'Anuncios', icon: '◉' },
      { href: '/playlists', label: 'Playlists', icon: '≡' },
    ],
  },
  {
    id: 'tablets', label: 'Tablets', links: [
      { href: '/tablets/compare', label: 'Comparar tablets', icon: '⊟' },
      { href: '/apk', label: 'APK Android', icon: '⬇' },
      { href: '/maintenance', label: 'Mantenimiento', icon: '⚙' },
    ],
  },
  {
    id: 'analitica', label: 'Analítica', links: [
      { href: '/stats', label: 'Estadísticas', icon: '◫' },
      { href: '/logs', label: 'Logs', icon: '☰' },
      { href: '/calendar', label: 'Calendario', icon: '▦' },
    ],
  },
  {
    id: 'interaccion', label: 'Interacción', links: [
      { href: '/abtests', label: 'A/B Tests', icon: '⊟' },
      { href: '/driver-points', label: 'Puntos taxistas', icon: '★' },
    ],
  },
  {
    id: 'sistema', label: 'Sistema', links: [
      { href: '/inventory', label: 'Inventario', icon: '⊟' },
      { href: '/notes', label: 'Notas', icon: '✎' },
      { href: '/reminders', label: 'Recordatorios', icon: '⏰' },
      { href: '/settings', label: 'Configuración', icon: '⚙' },
      { href: '/profile', label: 'Perfil', icon: '◷' },
      { href: '/help', label: 'Ayuda', icon: '?' },
    ],
  },
  {
    id: 'a-desarrollo', label: 'A desarrollo', links: [
      { href: '/referrals', label: 'Referidos', icon: '◎' },
      { href: '/executive', label: 'Ejecutivo', icon: '◈' },
      { href: '/impact', label: 'Impacto', icon: '🌿' },
      { href: '/groups', label: 'Grupos', icon: '⊞' },
      { href: '/calculator', label: 'Calculadora', icon: '⊞' },
      { href: '/archive', label: 'Archivo', icon: '⊗' },
      { href: '/geofencing', label: 'Geofencing', icon: '◎' },
    ],
  },
];

const COLLAPSE_STORAGE_KEY = 'iconads-sidebar-collapsed';

export default function Sidebar({ open = false, onNavigate }: { open?: boolean; onNavigate?: () => void } = {}) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { isAdmin } = useRole();
  const [pendingAds, setPendingAds] = useState(0);
  const [notifications, setNotifications] = useState<Notifications | null>(null);
  const [showNotif, setShowNotif] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const seenAlertIds = useRef<Set<number>>(new Set());
  const firstNotifLoad = useRef(true);

  useEffect(() => {
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* ignore */ }
    const fetchNotifs = () => {
      api.getPendingAdsCount().then((r) => setPendingAds(r.count)).catch(() => {});
      api.getNotifications().then((n) => {
        setNotifications(n);
        const alerts = n.systemAlerts ?? [];
        if (firstNotifLoad.current) {
          // La primera carga sólo siembra los ids: no queremos un pop-up por
          // cada alerta vieja al abrir el panel.
          alerts.forEach((a) => seenAlertIds.current.add(a.id));
          firstNotifLoad.current = false;
          return;
        }
        for (const a of alerts) {
          if (seenAlertIds.current.has(a.id)) continue;
          seenAlertIds.current.add(a.id);
          try {
            if ('Notification' in window && Notification.permission === 'granted') {
              const notif = new Notification(`ICON ADS — ${a.title}`, { body: a.body ?? '', tag: `alert-${a.id}` });
              void notif;
            }
          } catch { /* ignore */ }
        }
      }).catch(() => {});
    };
    fetchNotifs();
    const id = setInterval(fetchNotifs, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLLAPSE_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads persisted collapse state from localStorage on mount, not a compiler target
      if (saved) setCollapsedGroups(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const isLinkActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <aside
      className={`ia-theme fixed inset-y-0 left-0 z-40 w-60 flex flex-col border-r border-[var(--divider)] transition duration-200 lg:static lg:z-auto lg:min-h-screen lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      style={{ background: 'var(--sidebar)' }}
    >
      <div className="px-5 py-5 border-b border-[var(--divider)]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--accent-strong)] flex items-center justify-center font-bold text-sm text-white">
            IA
          </div>
          <div>
            <p className="font-semibold text-[15px] text-[var(--text)]">Icon Ads</p>
            <p className="text-xs text-[var(--muted)]">Panel admin</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-3 overflow-y-auto">
        {linkGroups.map((g) => ({ ...g, links: isAdmin ? g.links : g.links.filter((l) => !ADMIN_ONLY_HREFS.has(l.href)) }))
          .filter((group) => group.links.length > 0)
          .map((group) => {
          const open = !collapsedGroups[group.id];
          return (
            <div key={group.id}>
              <button
                onClick={() => toggleGroup(group.id)}
                className="group/hdr w-full flex items-center gap-2 px-3 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-2)] hover:text-[var(--muted)] transition-colors"
              >
                <span className="flex-1 text-left">{group.label}</span>
                <span className={`text-[10px] opacity-0 transition group-hover/hdr:opacity-100 ${open ? 'rotate-90' : ''}`}>▸</span>
              </button>
              {open && (
                <div className="space-y-0.5 mt-0.5">
                  {group.links.map((link) => {
                    const active = isLinkActive(link.href);
                    const monitorAlerts = notifications?.monitorAlerts ?? 0;
                    const badge =
                      link.href === '/ads' && pendingAds > 0 ? pendingAds
                        : link.href === '/monitor' && monitorAlerts > 0 ? monitorAlerts
                          : null;
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={() => onNavigate?.()}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                          active ? 'bg-[var(--accent-strong)] text-white font-medium' : 'text-[var(--text-2)] hover:text-[var(--text)]'
                        }`}
                        style={!active ? { ['--hover-bg' as string]: 'var(--sidebar-hover)' } : undefined}
                        onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--sidebar-hover)'; }}
                        onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = ''; }}
                      >
                        <NavIcon href={link.href} />
                        <span className="flex-1">{link.label}</span>
                        {badge && (
                          <span className="text-[11px] font-bold bg-[var(--danger)] text-[#3a0d12] rounded-full min-w-[22px] h-[20px] flex items-center justify-center px-1.5">
                            {badge > 99 ? '99+' : badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-[var(--divider)] space-y-1">
        {/* #26 — Notification bell */}
        <div className="relative">
          <button
            onClick={() => setShowNotif((s) => !s)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-[var(--muted)] hover:text-[var(--text)] transition-colors"
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sidebar-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '')}
          >
            <span>🔔</span>
            <span className="flex-1">Notificaciones</span>
            {(() => {
              const sysN = notifications?.systemAlertCount ?? notifications?.systemAlerts?.length ?? 0;
              const n = (notifications?.total ?? 0) + sysN;
              if (!n) return null;
              const crit = notifications?.systemAlerts?.some((a) => a.severity === 'critical');
              return (
                <span className={`text-xs font-bold text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 ${crit ? 'bg-red-600 animate-pulse' : 'bg-red-500'}`}>
                  {n > 99 ? '99+' : n}
                </span>
              );
            })()}
          </button>
          {showNotif && notifications && (
            <div
              className="absolute bottom-full left-0 right-0 mb-1 rounded-xl shadow-xl border z-50 overflow-hidden"
              style={{ background: 'var(--card)', borderColor: 'var(--border-md)' }}
            >
              <div className="px-3 py-2 border-b text-xs font-semibold" style={{ borderColor: 'var(--border-md)', color: 'var(--text-muted)' }}>
                ALERTAS
              </div>
              {notifications.total === 0 && (notifications.systemAlerts?.length ?? 0) === 0 ? (
                <p className="px-3 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>Sin alertas activas</p>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  {(notifications.systemAlerts ?? []).map((a) => (
                    <div key={a.id} className="flex items-start gap-2 px-3 py-2 border-b" style={{ borderColor: 'var(--border)', background: a.severity === 'critical' ? 'rgba(239,68,68,0.08)' : undefined }}>
                      <span className="shrink-0">{SEV_ICON[a.severity] ?? '•'}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold">{a.title}</p>
                        {a.body && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{a.body}</p>}
                      </div>
                      <button
                        onClick={async () => { await api.ackAlert(a.id).catch(() => {}); setNotifications((prev) => prev ? { ...prev, systemAlerts: (prev.systemAlerts ?? []).filter((x) => x.id !== a.id), systemAlertCount: Math.max(0, (prev.systemAlertCount ?? 1) - 1) } : prev); }}
                        className="shrink-0 text-xs px-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700" title="Marcar leída"
                      >✓</button>
                    </div>
                  ))}
                  {notifications.pendingAds > 0 && (
                    <Link href="/ads" onClick={() => setShowNotif(false)} className="flex items-start gap-2 px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-950/20 border-b" style={{ borderColor: 'var(--border)' }}>
                      <span className="text-amber-500 shrink-0">⏳</span>
                      <span className="text-xs">{notifications.pendingAds} anuncio{notifications.pendingAds !== 1 ? 's' : ''} pendiente{notifications.pendingAds !== 1 ? 's' : ''} de aprobación</span>
                    </Link>
                  )}
                  {notifications.expiringAds.map((c) => (
                    <Link href="/ads" key={c.id} onClick={() => setShowNotif(false)} className="flex items-start gap-2 px-3 py-2 hover:bg-red-50 dark:hover:bg-red-950/20 border-b" style={{ borderColor: 'var(--border)' }}>
                      <span className="text-red-500 shrink-0">⏰</span>
                      <span className="text-xs">{c.name} termina en {c.daysLeft}d</span>
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

        <div className="px-3 py-2">
          <p className="text-xs font-medium text-[var(--text)] truncate">{user?.name}</p>
          <p className="text-xs text-[var(--muted-2)] truncate">{user?.email}</p>
          {user?.role && (
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium mt-1 inline-block ${
              user.role === 'superadmin' ? 'bg-[var(--surface-2)] text-[var(--accent)]' : 'bg-[var(--surface-2)] text-[var(--muted)]'
            }`}>
              {user.role}
            </span>
          )}
        </div>
        <button
          onClick={logout}
          className="w-full text-left px-3 py-2 rounded-lg text-sm text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sidebar-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '')}
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
