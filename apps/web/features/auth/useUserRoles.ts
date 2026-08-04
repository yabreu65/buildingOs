'use client';

import { useAuth } from './useAuth';
import { useHasAnyRoleInTenant } from '@/features/tenancy/hooks/useEffectiveRole';

/**
 * Hook to get the current user's roles for the active tenant
 *
 * Returns an array of role strings for the user's current membership
 * - SUPER_ADMIN is returned globally regardless of tenant
 * - For other roles, returns the roles from the active tenant membership
 * - Returns empty array if no auth session exists
 *
 * Usage:
 * const roles = useUserRoles();
 * const canUseAi = roles.includes('TENANT_ADMIN') || roles.includes('OPERATOR');
 */
export function useUserRoles(): string[] {
  const { currentUser } = useAuth();

  if (!currentUser?.roles) {
    return [];
  }

  return currentUser.roles;
}

/**
 * Helper function to check if the current tenant membership can access AI settings.
 *
 * Only tenant-scoped roles are considered. Global or stale roles from another tenant
 * are intentionally ignored.
 */
export function useCanAccessAi(tenantId?: string): boolean {
  return useHasAnyRoleInTenant(tenantId, ['TENANT_OWNER', 'TENANT_ADMIN', 'OPERATOR']);
}
