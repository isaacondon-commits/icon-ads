'use client';

// Marco común de las pantallas de acceso del portal (login, activar, restablecer).
export default function AuthCard({ subtitle, children }: { subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-2xl">
        <div className="mb-7 text-center">
          <img src="/monitor/toucan.png" alt="" aria-hidden="true" className="mx-auto mb-3 h-16 w-auto" />
          <h1 className="text-2xl font-bold tracking-wide text-[var(--accent)]">ICON ADS</h1>
          <p className="mt-1 text-xs uppercase tracking-[0.25em] text-[var(--muted)]">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

export function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-lg border border-[var(--danger-border)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-4 py-3 text-sm text-[var(--danger)]">
      {message}
    </div>
  );
}

export function SubmitButton({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return (
    <button type="submit" disabled={loading}
      className="h-11 w-full rounded-full bg-[var(--accent-strong)] font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50">
      {loading ? 'Un momento…' : children}
    </button>
  );
}
