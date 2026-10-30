'use client';

import { useEffect, useState, useSyncExternalStore, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { passwordHint } from '@/lib/portal';
import AuthCard, { FormError, SubmitButton } from './AuthCard';

// Activar cuenta (invitación) y restablecer contraseña: el enlace del mail trae
// el token en el fragmento (#t=…). Se lee y se borra de la barra de direcciones
// enseguida, para que no quede en el historial ni se comparta por error.
let capturedToken = '';
function readToken() {
  const t = new URLSearchParams(window.location.hash.slice(1)).get('t');
  if (t) capturedToken = t;
  return capturedToken;
}
const noSubscribe = () => () => {};

export default function SetPasswordForm({ title, intro, submitLabel, onSubmit }: {
  title: string; intro: string; submitLabel: string;
  onSubmit: (token: string, password: string) => Promise<unknown>;
}) {
  const router = useRouter();
  // null en el servidor; en el navegador, el token del enlace ('' si no vino).
  const token = useSyncExternalStore(noSubscribe, readToken, () => null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const hint = passwordHint(password, confirm);
    if (hint) { setError(hint); return; }
    setError(''); setLoading(true);
    try {
      await onSubmit(token ?? '', password);
      router.replace('/portal/estadisticas');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar.');
      setLoading(false);
    }
  };

  if (token === null) return null;
  if (!token) {
    return (
      <AuthCard subtitle="Portal de empresas">
        <FormError message="El enlace no es válido. Abrí el enlace completo del mail, o pedí uno nuevo." />
        <a href="/portal" className="mt-5 block text-center text-sm text-[var(--accent)] hover:underline">Ir al ingreso</a>
      </AuthCard>
    );
  }

  return (
    <AuthCard subtitle="Portal de empresas">
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      <p className="mb-5 text-sm text-[var(--text-2)]">{intro}</p>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="pw" className="mb-1.5 block text-sm font-medium text-[var(--text-2)]">Contraseña nueva</label>
          <input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} className="input h-11" />
        </div>
        <div>
          <label htmlFor="pw2" className="mb-1.5 block text-sm font-medium text-[var(--text-2)]">Repetila</label>
          <input id="pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={10} className="input h-11" />
        </div>
        <p className="text-xs text-[var(--muted)]">Mínimo 10 caracteres. Una frase corta que recuerdes es mejor que una palabra con símbolos.</p>
        <FormError message={error} />
        <SubmitButton loading={loading}>{submitLabel}</SubmitButton>
      </form>
    </AuthCard>
  );
}
