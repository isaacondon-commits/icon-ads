'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function ProfilePage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (newPassword !== confirmPassword) { setError('Las contraseñas no coinciden'); return; }
    if (newPassword.length < 8) { setError('La nueva contraseña debe tener al menos 8 caracteres'); return; }
    setSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setSuccess('Contraseña actualizada correctamente');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cambiar contraseña');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold mb-6">Perfil</h1>

      <div className="card p-6 mb-6">
        <h2 className="font-semibold mb-4">Información de cuenta</h2>
        <div className="space-y-3">
          {[
            { label: 'Nombre', value: user?.name },
            { label: 'Email', value: user?.email },
            { label: 'Rol', value: user?.role },
          ].map(({ label, value }) => (
            <div key={label} className="flex gap-4">
              <span className="w-20 text-sm shrink-0" style={{ color: 'var(--text-muted)' }}>{label}</span>
              <span className="text-sm font-medium">{value ?? '—'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-6">
        <h2 className="font-semibold mb-4">Cambiar contraseña</h2>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className="block text-sm mb-1.5" style={{ color: 'var(--text-muted)' }}>Contraseña actual</label>
            <input
              type="password"
              className="input w-full"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="block text-sm mb-1.5" style={{ color: 'var(--text-muted)' }}>Nueva contraseña</label>
            <input
              type="password"
              className="input w-full"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="block text-sm mb-1.5" style={{ color: 'var(--text-muted)' }}>Confirmar nueva contraseña</label>
            <input
              type="password"
              className="input w-full"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-emerald-600">{success}</p>}

          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-5 py-2 rounded-lg text-sm font-medium"
          >
            {saving ? 'Guardando...' : 'Cambiar contraseña'}
          </button>
        </form>
      </div>
    </div>
  );
}
