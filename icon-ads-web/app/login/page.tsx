'use client';

import { useState, FormEvent } from 'react';
import { useAuth } from '@/lib/auth-context';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('admin@iconads.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-[var(--bg)] p-4">
      <style>{`
        @keyframes ia-float { 0%,100% { transform: translateY(0) rotate(-3deg) } 50% { transform: translateY(-14px) rotate(2deg) } }
        @keyframes ia-glow { 0%,100% { opacity: .35 } 50% { opacity: .6 } }
        @media (prefers-reduced-motion: reduce) { .ia-anim { animation: none !important } }
      `}</style>
      <div aria-hidden="true" className="ia-anim pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent-strong)] blur-[120px]"
        style={{ animation: 'ia-glow 6s ease-in-out infinite' }} />

      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <img src="/monitor/toucan.png" alt="" aria-hidden="true" className="ia-anim mx-auto mb-3 h-20 w-auto drop-shadow-[0_0_24px_rgba(79,179,255,0.45)]"
            style={{ animation: 'ia-float 7s ease-in-out infinite' }} />
          <h1 className="text-2xl font-bold tracking-wide text-[var(--accent)]">ICONADS</h1>
          <p className="mt-1 text-xs uppercase tracking-[0.25em] text-[var(--muted)]">Panel de administración</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--text-2)]">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="input h-11" placeholder="admin@iconads.com" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--text-2)]">Contraseña</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="input h-11" placeholder="••••••••" />
          </div>

          {error && (
            <div className="rounded-lg border border-[var(--danger-border)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-4 py-3 text-sm text-[var(--danger)]">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading}
            className="h-11 w-full rounded-full bg-[var(--accent-strong)] font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50">
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
