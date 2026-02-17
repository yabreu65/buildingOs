'use client';

import { getSession } from './session.storage';
import type { AuthSession } from './auth.types';

/**
 * Synchronous hook to get the current auth session
 * Used in server or client contexts where you need immediate access
 */
export function useAuthSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  return getSession();
}

/**
 * Synchronous helper to check if user has a specific role in the current active tenant
 */
export function useHasRole(role: string): boolean {
  const session = useAuthSession();
  if (!session) return false;

  const activeMembership = session.memberships.find(
    (m) => m.tenantId === session.activeTenantId
  );
  return activeMembership?.roles.includes(role as any) ?? false;
}

/**
 * Check if user is SUPER_ADMIN (not tenant-specific)
 */
export function useIsSuperAdmin(): boolean {
  const session = useAuthSession();
  if (!session) return false;

  // SUPER_ADMIN role can exist in any membership
  return session.memberships.some((m) => m.roles.includes('SUPER_ADMIN'));
}

/**
 * Get the active tenant ID from session
 */
export function useActiveTenantId(): string | null {
  const session = useAuthSession();
  return session?.activeTenantId ?? null;
}
