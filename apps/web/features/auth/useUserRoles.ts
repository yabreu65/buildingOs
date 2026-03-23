'use client';

import { useAuth } from './useAuth';

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
 * Helper function to check if user has admin-level access
 * (can see all AI features, not just residents)
 */
export function useCanAccessAi(): boolean {
  const roles = useUserRoles();
  return roles.some((role) =>
    ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR', 'SUPER_ADMIN'].includes(role)
  );
}
