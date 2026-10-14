'use client';

// Contenedor común de las páginas del panel con el estilo del Monitor: el
// tucán de ICON animado detrás del texto, arriba a la derecha, y un encabezado
// (título, bajada y acciones) con la paleta. El contenido va debajo.

export function AnimatedToucan() {
  return (
    <>
      <style>{`
        @keyframes ia-float { 0%,100% { transform: translateY(0) rotate(-3deg) } 50% { transform: translateY(-14px) rotate(2deg) } }
        @keyframes ia-glow { 0%,100% { opacity: .35 } 50% { opacity: .6 } }
        @media (prefers-reduced-motion: reduce) { .ia-anim { animation: none !important } }
      `}</style>
      <div aria-hidden="true" className="pointer-events-none absolute right-6 top-2 -z-10 hidden md:block">
        <div className="ia-anim absolute inset-6 rounded-full bg-[var(--accent-strong)] blur-3xl"
          style={{ animation: 'ia-glow 6s ease-in-out infinite' }} />
        <img src="/monitor/toucan.png" alt="" className="ia-anim relative w-[220px] opacity-35 lg:w-[260px]"
          style={{ animation: 'ia-float 7s ease-in-out infinite' }} />
      </div>
    </>
  );
}

export default function PageShell({ title, subtitle, actions, children }: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative isolate -mx-4 -mt-4 overflow-x-clip px-4 pt-4 sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-6 lg:-mx-8 lg:-mt-8 lg:px-8 lg:pt-8">
      <AnimatedToucan />
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[var(--muted)]">ICON ADS</p>
          <h1 className="mt-0.5 text-3xl font-bold tracking-tight text-[var(--text)]">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-[var(--muted)]">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  );
}
