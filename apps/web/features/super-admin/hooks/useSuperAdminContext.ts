import { useContext } from 'react';
import { SuperAdminContext } from '../super-admin-context';

/**
 * Hook para acceder al contexto de SUPER_ADMIN
 */
export function useSuperAdminContext() {
  const context = useContext(SuperAdminContext);

  if (!context) {
    throw new Error('useSuperAdminContext debe ser usado dentro de SuperAdminProvider');
  }

  return context;
}
