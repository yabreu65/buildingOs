'use client';

import { useEffect } from 'react';
import { useAuth } from './useAuth';
import { useSuperAdminContext } from '@/features/super-admin/hooks/useSuperAdminContext';
import { setLastTenant } from './session.storage';

/**
 * SuperAdminAuthMiddleware: Sincroniza activeTenantId entre SuperAdminContext y AuthSession
 *
 * Cuando un SUPER_ADMIN usuario entra en un tenant desde el dashboard:
 * - SuperAdminContext actualiza su activeTenantId
 * - Este middleware actualiza la sesión auth y localStorage
 * - La información está disponible en toda la app
 *
 * USAGE: Envuelve la app con este componente en layouts que necesiten tenant switching
 */
export default function SuperAdminAuthMiddleware({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const { activeTenantId: contextTenantId } = useSuperAdminContext();

  // Sincronizar cuando el tenantId del contexto cambia
  useEffect(() => {
    if (!session || !contextTenantId) {
      return;
    }

    // Verificar que el tenant es válido en las membresías
    const hasMembership = session.memberships.some((m) => m.tenantId === contextTenantId);
    if (!hasMembership) {
      console.warn(`[SuperAdminAuthMiddleware] Tenant ${contextTenantId} not in memberships`);
      return;
    }

    // Actualizar último tenant usado
    setLastTenant(contextTenantId);
  }, [session, contextTenantId]);

  return <>{children}</>;
}
