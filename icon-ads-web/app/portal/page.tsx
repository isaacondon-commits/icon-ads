'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { portal } from '@/lib/portal';
import AuthCard, { FormError, SubmitButton } from '@/components/portal/AuthCard';

export default function PortalLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  // Si ya hay sesión, directo a las estadísticas.
  useEffect(() => {
    portal.me().then(() => router.replace('/portal/estadisticas')).catch(() => {});
  }, [router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setNotice(''); setLoading(true);
    try {
      if (mode === 'login') {
        await portal.login(email, password);
        router.replace('/portal/estadisticas');
      } else {
        const r = await portal.forgotPassword(email);
        setNotice(r.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard subtitle="Portal de empresas">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-[var(--text-2)]">Email</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required className="input h-11" />
        </div>
        {mode === 'login' && (
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-[var(--text-2)]">Contraseña</label>
            <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="input h-11" />
          </div>
        )}
        <FormError message={error} />
        {notice && <p className="rounded-lg bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--text-2)]">{notice}</p>}
        <SubmitButton loading={loading}>{mode === 'login' ? 'Ingresar' : 'Enviarme el enlace'}</SubmitButton>
      </form>
      <button type="button" onClick={() => { setMode(mode === 'login' ? 'forgot' : 'login'); setError(''); setNotice(''); }}
        className="mt-5 w-full text-center text-sm text-[var(--accent)] hover:underline">
        {mode === 'login' ? 'Olvidé mi contraseña' : 'Volver a ingresar'}
      </button>
    </AuthCard>
  );
}
