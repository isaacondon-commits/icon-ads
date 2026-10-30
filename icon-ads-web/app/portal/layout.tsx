import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ICON ADS — Portal de empresas',
  description: 'Estadísticas de tus campañas en la flota ICON ADS',
  robots: { index: false, follow: false },
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">{children}</div>;
}
