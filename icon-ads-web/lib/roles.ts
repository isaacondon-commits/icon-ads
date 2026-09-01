'use client';

import { useAuth } from './auth-context';

// Modelo de roles:
//  - admin / superadmin : acceso pleno (crear, editar, borrar, tablets, usuarios, settings)
//  - supervisor         : sólo CREAR anuncios, campañas y playlists; el resto lectura
//  - operator           : sólo lectura en todo
export function useRole() {
  const { user } = useAuth();
  const role = user?.role ?? '';
  const isAdmin = role === 'admin' || role === 'superadmin';
  const isSupervisor = role === 'supervisor';
  const isOperator = role === 'operator';
  return {
    role,
    isAdmin,
    isSupervisor,
    isOperator,
    /** Editar / borrar contenido, y todo lo de tablets / usuarios / settings. */
    canManage: isAdmin,
    /** Crear anuncios, campañas y playlists nuevos. */
    canCreateContent: isAdmin || isSupervisor,
  };
}
