import { emitBoStorageChange } from "@/shared/lib/storage/events";
import type { ImpersonationMetadata } from "./impersonation.types";
import type { AuthSession } from "../auth/auth.types";

const KEYS = {
  METADATA: "bo_impersonation",
  TOKEN_BACKUP: "bo_token_sa_backup",
  SESSION_BACKUP: "bo_session_sa_backup",
} as const;

export function getImpersonationMetadata(): ImpersonationMetadata | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(KEYS.METADATA);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ImpersonationMetadata;
  } catch {
    return null;
  }
}

export function setImpersonationMetadata(meta: ImpersonationMetadata): void {
  localStorage.setItem(KEYS.METADATA, JSON.stringify(meta));
  emitBoStorageChange();
}

export function clearImpersonationMetadata(): void {
  localStorage.removeItem(KEYS.METADATA);
  emitBoStorageChange();
}

export function getTokenBackup(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEYS.TOKEN_BACKUP);
}

export function setTokenBackup(token: string): void {
  localStorage.setItem(KEYS.TOKEN_BACKUP, token);
}

export function getSessionBackup(): AuthSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(KEYS.SESSION_BACKUP);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export function setSessionBackup(session: AuthSession): void {
  localStorage.setItem(KEYS.SESSION_BACKUP, JSON.stringify(session));
}

export function clearAllImpersonationData(): void {
  localStorage.removeItem(KEYS.METADATA);
  localStorage.removeItem(KEYS.TOKEN_BACKUP);
  localStorage.removeItem(KEYS.SESSION_BACKUP);
  emitBoStorageChange();
}

export function isImpersonationExpired(): boolean {
  const meta = getImpersonationMetadata();
  if (!meta) return false;
  return new Date(meta.expiresAt) < new Date();
}
