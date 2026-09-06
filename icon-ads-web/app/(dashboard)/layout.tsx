'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import Sidebar from '@/components/Sidebar';
import Breadcrumbs from '@/components/Breadcrumbs';
import GoogleAnalytics from '@/components/GoogleAnalytics';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Cajón lateral en pantallas chicas (tablet/celular). En >=lg el sidebar es
  // fijo como siempre y este estado no afecta nada. Se cierra solo al cambiar
  // de ruta (patrón "ajustar estado en render", sin useEffect).
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setDrawerOpen(false);
  }

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  // Keyboard shortcuts: ESC closes any open modal (pages handle this via custom event)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') document.dispatchEvent(new CustomEvent('iconads:close-modal'));
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        document.dispatchEvent(new CustomEvent('iconads:new'));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div style={{ color: 'var(--text-muted)' }}>Cargando...</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--bg)' }}>
      <GoogleAnalytics />

      {/* Fondo oscuro al abrir el cajón (sólo <lg) */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden
        />
      )}

      <Sidebar open={drawerOpen} onNavigate={() => setDrawerOpen(false)} />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Barra superior sólo en pantallas chicas */}
        <header
          className="lg:hidden sticky top-0 z-20 flex items-center gap-3 h-14 px-4 border-b"
          style={{ background: 'var(--card)', borderColor: 'var(--border-md)' }}
        >
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Abrir menú"
            className="-ml-2 p-2 rounded-lg text-xl leading-none"
            style={{ color: 'var(--text)' }}
          >
            ☰
          </button>
          <span className="font-semibold text-sm" style={{ color: 'var(--text)' }}>Icon Ads</span>
        </header>

        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 overflow-auto" style={{ color: 'var(--text)' }}>
          <Breadcrumbs />
          {children}
        </main>
      </div>
    </div>
  );
}
