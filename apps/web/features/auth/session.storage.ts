import { emitBoStorageChange } from '@/shared/lib/storage/events';
import type { AuthSession } from './auth.types';
import type { PortalContext } from './landing-route';

const KEY_SESSION = 'bo_session';
const KEY_LAST_TENANT = 'bo_last_tenant';
const KEY_LAST_PORTAL = 'bo_last_portal';

/**
 * Stores the authenticated session in localStorage and emits a storage change event.
 * @param session - The user's session object with memberships and tenant info
 */
export function setSession(session: AuthSession): void {
  localStorage.setItem(KEY_SESSION, JSON.stringify(session));
  emitBoStorageChange();
}

/**
 * Retrieves the authenticated session from localStorage.
 * Validates the session structure before returning to prevent parsing errors.
 * Returns null if not in browser environment, session doesn't exist, or validation fails.
 * @returns The stored AuthSession object or null
 */
export function getSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(KEY_SESSION);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'activeTenantId' in parsed &&
      'memberships' in parsed &&
      Array.isArray((parsed as { memberships: unknown }).memberships)
    ) {
      return parsed as AuthSession;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Removes the authenticated session from localStorage and emits a storage change event.
 */
export function clearSession(): void {
  localStorage.removeItem(KEY_SESSION);
  emitBoStorageChange();
}

/**
 * Stores the last active tenant ID for quick resumption of user session.
 * Emits a storage change event for UI updates.
 * @param tenantId - The tenant ID to remember as the last active one
 */
export function setLastTenant(tenantId: string): void {
  const currentTenantId = localStorage.getItem(KEY_LAST_TENANT);
  if (currentTenantId === tenantId) {
    return;
  }

  localStorage.setItem(KEY_LAST_TENANT, tenantId);
  emitBoStorageChange();
}

/**
 * Retrieves the last active tenant ID from localStorage.
 * Used to restore the user to their previous tenant context.
 * Returns null if not in browser environment or no previous tenant was recorded.
 * @returns The stored tenant ID or null
 */
export function getLastTenant(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(KEY_LAST_TENANT);
}

/**
 * Removes the last active tenant ID from localStorage and emits a storage change event.
 */
export function clearLastTenant(): void {
  localStorage.removeItem(KEY_LAST_TENANT);
  emitBoStorageChange();
}

/**
 * Stores the last active portal context for quick resumption within the current browser.
 * This preference is intentionally browser-scoped and is cleared on logout.
 * @param portal - The portal context to remember as the last active one
 */
export function setLastPortal(portal: PortalContext): void {
  const currentPortal = localStorage.getItem(KEY_LAST_PORTAL);
  if (currentPortal === portal) {
    return;
  }

  localStorage.setItem(KEY_LAST_PORTAL, portal);
  emitBoStorageChange();
}

/**
 * Retrieves the last active portal context from localStorage.
 * @returns The stored portal context or null
 */
export function getLastPortal(): PortalContext | null {
  if (typeof window === 'undefined') return null;

  const value = localStorage.getItem(KEY_LAST_PORTAL);
  return value === 'resident' || value === 'admin' ? value : null;
}

/**
 * Removes the last active portal context and emits a storage change event.
 */
export function clearLastPortal(): void {
  localStorage.removeItem(KEY_LAST_PORTAL);
  emitBoStorageChange();
}

/**
 * Completely clears all BuildingOS authentication and app data from localStorage.
 * Removes auth keys and all bo_* prefixed keys.
 * Prevents data leakage when multiple users access the same browser.
 * Emits a storage change event for UI updates.
 */
export function clearAuth(): void {
  const keysToRemove: string[] = [KEY_SESSION, KEY_LAST_TENANT, KEY_LAST_PORTAL];

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('bo_')) {
        keysToRemove.push(key);
      }
    }
  } catch (error) {
    console.warn('[auth] Unable to enumerate auth storage keys.', error);
  }

  for (const key of keysToRemove) {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn(`[auth] Unable to remove storage key "${key}".`, error);
    }
  }

  emitBoStorageChange();
}
