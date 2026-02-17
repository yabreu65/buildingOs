'use client';

import { useAuthSession } from '@/features/auth/useAuthSession';
import type { Role } from '@/features/auth/auth.types';

const ROLE_PRIORITY: Record<Role, number> = {
  TENANT_OWNER: 4,
  TENANT_ADMIN: 3,
  OPERATOR: 2,
  RESIDENT: 1,
  SUPER_ADMIN: 5, // Highest priority if it exists
};

/**
 * useEffectiveRole: Get the user's effective role in a specific tenant
 *
 * Returns the highest-priority role from the user's roles in that tenant.
 * Priority order: SUPER_ADMIN > TENANT_OWNER > TENANT_ADMIN > OPERATOR > RESIDENT
 *
 * @param tenantId The tenant ID to check roles for
 * @returns The highest-priority role, or null if user has no roles in this tenant
 */
export function useEffectiveRole(tenantId: string | undefined): Role | null {
  const session = useAuthSession();

  if (!session || !tenantId) {
    return null;
  }

  // Find the membership for this specific tenant
  const membership = session.memberships.find((m) => m.tenantId === tenantId);

  if (!membership || membership.roles.length === 0) {
    return null;
  }

  // Return the highest-priority role
  const sortedRoles = [...membership.roles].sort(
    (a, b) => (ROLE_PRIORITY[b] ?? 0) - (ROLE_PRIORITY[a] ?? 0)
  );

  return sortedRoles[0] ?? null;
}

/**
 * Check if user has a specific role in a tenant
 * @param tenantId The tenant ID
 * @param role The role to check for
 * @returns true if user has this role in the tenant
 */
export function useHasRoleInTenant(
  tenantId: string | undefined,
  role: Role
): boolean {
  const session = useAuthSession();

  if (!session || !tenantId) {
    return false;
  }

  const membership = session.memberships.find((m) => m.tenantId === tenantId);
  return membership?.roles.includes(role) ?? false;
}

/**
 * Check if user has any of the specified roles in a tenant
 * @param tenantId The tenant ID
 * @param roles Array of roles to check
 * @returns true if user has at least one of these roles
 */
export function useHasAnyRoleInTenant(
  tenantId: string | undefined,
  roles: Role[]
): boolean {
  const session = useAuthSession();

  if (!session || !tenantId) {
    return false;
  }

  const membership = session.memberships.find((m) => m.tenantId === tenantId);
  if (!membership) return false;

  return roles.some((role) => membership.roles.includes(role));
}

/**
 * Check if user can access admin features in a tenant
 * Admins are: TENANT_OWNER and TENANT_ADMIN
 */
export function useCanAdministerTenant(tenantId: string | undefined): boolean {
  return useHasAnyRoleInTenant(tenantId, ['TENANT_OWNER', 'TENANT_ADMIN']);
}
