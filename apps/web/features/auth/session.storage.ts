import { emitBoStorageChange } from "@/shared/lib/storage/events";
import type { AuthSession } from "./auth.types";

const KEY_TOKEN = "bo_token";
const KEY_SESSION = "bo_session";
const KEY_LAST_TENANT = "bo_last_tenant";

/**
 * Stores the authentication token in localStorage and emits a storage change event.
 * @param token - The JWT token to store
 */
export function setToken(token: string): void {
  localStorage.setItem(KEY_TOKEN, token);
  emitBoStorageChange();
}

/**
 * Retrieves the stored authentication token from localStorage.
 * Returns null if not in browser environment or token doesn't exist.
 * @returns The stored JWT token or null
 */
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY_TOKEN);
}

/**
 * Removes the authentication token from localStorage and emits a storage change event.
 */
export function clearToken(): void {
  localStorage.removeItem(KEY_TOKEN);
  emitBoStorageChange();
}

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
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(KEY_SESSION);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    
    // Validación estructural básica sin usar any
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "activeTenantId" in parsed &&
      "memberships" in parsed &&
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
  if (typeof window === "undefined") return null;
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
 * Completely clears all BuildingOS authentication and app data from localStorage.
 * Removes auth keys (token, session, lastTenant) and all bo_* prefixed keys.
 * Prevents data leakage when multiple users access the same browser.
 * Emits a storage change event for UI updates.
 */
export function clearAuth(): void {
  try {
    // Clear auth keys
    localStorage.removeItem(KEY_TOKEN);
    localStorage.removeItem(KEY_SESSION);
    localStorage.removeItem(KEY_LAST_TENANT);

    // SECURITY: Also clear ALL BuildingOS app data (bo_* keys)
    // to prevent data leakage if another user logs in on same browser
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('bo_')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));

    emitBoStorageChange();
  } catch {
    // noop
  }
}
