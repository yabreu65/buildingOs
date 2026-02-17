import { emitBoStorageChange } from '@/shared/lib/storage/events';
import type { User } from './units.types';

const getStorageKey = (tenantId: string) => `bo_users_${tenantId}`;

function safeParseArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * Obtiene todos los usuarios del tenant
 */
export function listUsers(tenantId: string): User[] {
  if (typeof window === 'undefined') return [];
  return safeParseArray<User>(localStorage.getItem(getStorageKey(tenantId)));
}

/**
 * Obtiene un usuario por ID
 */
export function getUserById(tenantId: string, userId: string): User | null {
  const users = listUsers(tenantId);
  return users.find((u) => u.id === userId) || null;
}

/**
 * Obtiene usuarios con rol RESIDENT
 */
export function listResidents(tenantId: string): User[] {
  return listUsers(tenantId).filter((u) => u.roles?.includes('RESIDENT'));
}

/**
 * Crea un usuario
 */
export function createUser(tenantId: string, input: Omit<User, 'id' | 'tenantId'>): User {
  const users = listUsers(tenantId);

  const newUser: User = {
    id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    tenantId,
    ...input,
  };

  localStorage.setItem(getStorageKey(tenantId), JSON.stringify([...users, newUser]));
  emitBoStorageChange();

  return newUser;
}

/**
 * Seed: crear usuarios por defecto si no existen
 */
export function seedUsersIfEmpty(tenantId: string): void {
  const users = listUsers(tenantId);
  if (users.length > 0) return;

  const mockUsers: Omit<User, 'id' | 'tenantId'>[] = [
    {
      fullName: 'Juan Pérez',
      email: 'juan@example.com',
      phone: '+1-555-0101',
      roles: ['RESIDENT', 'OWNER'],
    },
    {
      fullName: 'María García',
      email: 'maria@example.com',
      phone: '+1-555-0102',
      roles: ['RESIDENT'],
    },
    {
      fullName: 'Carlos López',
      email: 'carlos@example.com',
      phone: '+1-555-0103',
      roles: ['RESIDENT', 'TENANT'],
    },
    {
      fullName: 'Ana Rodríguez',
      email: 'ana@example.com',
      roles: ['RESIDENT'],
    },
    {
      fullName: 'Pedro Martínez',
      email: 'pedro@example.com',
      roles: ['OWNER'],
    },
  ];

  for (const user of mockUsers) {
    createUser(tenantId, user);
  }
}
