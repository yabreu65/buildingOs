import { emitBoStorageChange } from '@/shared/lib/storage/events';
import type { ImpersonationMetadata } from './impersonation.types';
import type { AuthSession } from '../auth/auth.types';

const KEYS = {
  METADATA: 'bo_impersonation',
  TOKEN: 'bo_impersonation_token',
  TOKEN_BACKUP: 'bo_impersonation_token_backup',
  SESSION_BACKUP: 'bo_session_sa_backup',
} as const;

function readSessionStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(key);
}

function writeSessionStorage(key: string, value: string): void {
  window.sessionStorage.setItem(key, value);
}

function removeSessionStorage(key: string): void {
  window.sessionStorage.removeItem(key);
}

export function getImpersonationMetadata(): ImpersonationMetadata | null {
  if (typeof window === 'undefined') return null;
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

export function getCurrentImpersonationToken(): string | null {
  return readSessionStorage(KEYS.TOKEN);
}

export function setCurrentImpersonationToken(token: string): void {
  writeSessionStorage(KEYS.TOKEN, token);
}

export function clearCurrentImpersonationToken(): void {
  removeSessionStorage(KEYS.TOKEN);
}

export function getTokenBackup(): string | null {
  return readSessionStorage(KEYS.TOKEN_BACKUP);
}

export function setTokenBackup(token: string): void {
  writeSessionStorage(KEYS.TOKEN_BACKUP, token);
}

export function getSessionBackup(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(KEYS.SESSION_BACKUP);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export function setSessionBackup(session: AuthSession): void {
  window.sessionStorage.setItem(KEYS.SESSION_BACKUP, JSON.stringify(session));
}

export function clearAllImpersonationData(): void {
  removeSessionStorage(KEYS.TOKEN);
  removeSessionStorage(KEYS.TOKEN_BACKUP);
  removeSessionStorage(KEYS.SESSION_BACKUP);
  localStorage.removeItem(KEYS.METADATA);
  emitBoStorageChange();
}

export function isImpersonationExpired(): boolean {
  const meta = getImpersonationMetadata();
  if (!meta) return false;
  return new Date(meta.expiresAt) < new Date();
}
