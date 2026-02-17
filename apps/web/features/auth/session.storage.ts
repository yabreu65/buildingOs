import { emitBoStorageChange } from "@/shared/lib/storage/events";
import type { AuthSession } from "./auth.types";

const KEY_TOKEN = "bo_token";
const KEY_SESSION = "bo_session";
const KEY_LAST_TENANT = "bo_last_tenant";

export function setToken(token: string): void {
  localStorage.setItem(KEY_TOKEN, token);
  emitBoStorageChange();
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY_TOKEN);
}

export function clearToken(): void {
  localStorage.removeItem(KEY_TOKEN);
  emitBoStorageChange();
}

export function setSession(session: AuthSession): void {
  localStorage.setItem(KEY_SESSION, JSON.stringify(session));
  emitBoStorageChange();
}

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

export function clearSession(): void {
  localStorage.removeItem(KEY_SESSION);
  emitBoStorageChange();
}

export function setLastTenant(tenantId: string): void {
  localStorage.setItem(KEY_LAST_TENANT, tenantId);
  emitBoStorageChange();
}

export function getLastTenant(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY_LAST_TENANT);
}

export function clearLastTenant(): void {
  localStorage.removeItem(KEY_LAST_TENANT);
  emitBoStorageChange();
}

export function clearAuth(): void {
  try {
    // Calling internal functions would trigger emit multiple times if we aren't careful,
    // but here it's fine or we can do raw removals and one emit.
    // Let's do raw removals and one emit for atomicity perception.
    localStorage.removeItem(KEY_TOKEN);
    localStorage.removeItem(KEY_SESSION);
    localStorage.removeItem(KEY_LAST_TENANT);
    emitBoStorageChange();
  } catch {
    // noop
  }
}
