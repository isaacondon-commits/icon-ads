'use client';

import { portal } from '@/lib/portal';
import SetPasswordForm from '@/components/portal/SetPasswordForm';

export default function ActivatePage() {
  return (
    <SetPasswordForm
      title="Creá tu contraseña"
      intro="Con esta contraseña vas a entrar al portal para ver las estadísticas de tus campañas."
      submitLabel="Crear contraseña y entrar"
      onSubmit={portal.activate}
    />
  );
}
