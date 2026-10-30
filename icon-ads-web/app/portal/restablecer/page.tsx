'use client';

import { portal } from '@/lib/portal';
import SetPasswordForm from '@/components/portal/SetPasswordForm';

export default function ResetPasswordPage() {
  return (
    <SetPasswordForm
      title="Elegí una contraseña nueva"
      intro="Al cambiarla se cierran las sesiones abiertas en otros dispositivos."
      submitLabel="Cambiar contraseña y entrar"
      onSubmit={portal.resetPassword}
    />
  );
}
