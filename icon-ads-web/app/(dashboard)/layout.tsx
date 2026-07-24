'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import Sidebar from '@/components/Sidebar';
import Breadcrumbs from '@/components/Breadcrumbs';
import GoogleAnalytics from '@/components/GoogleAnalytics';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

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
      <Sidebar />
      <main className="flex-1 pt-16 px-4 pb-4 lg:p-8 overflow-auto min-w-0" style={{ color: 'var(--text)' }}>
        <Breadcrumbs />
        {children}
      </main>
    </div>
  );
}
