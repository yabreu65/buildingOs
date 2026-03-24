/**
 * Centralized storage service for multi-tenant localStorage management.
 * Provides type-safe, validated access to localStorage with proper error handling.
 *
 * Pattern: bo_<entity> or bo_<entity>_<tenantId> for tenant-scoped data
 */

import { emitBoStorageChange } from './events';

export class StorageService {
  /**
   * Generate storage key with optional tenant scope.
   * @param entity - Entity name (users, buildings, tenants, etc.)
   * @param tenantId - Optional tenant ID for multi-tenant scoping
   * @returns Scoped key: bo_<entity> or bo_<entity>_<tenantId>
   */
  static getKey(entity: string, tenantId?: string): string {
    if (!tenantId) {
      return `bo_${entity}`;
    }
    return `bo_${entity}_${tenantId}`;
  }

  /**
   * Set item in localStorage with JSON serialization.
   * Automatically handles window availability check and emits change event.
   * @param entity - Entity name
   * @param data - Data to store (will be JSON.stringify'd)
   * @param tenantId - Optional tenant ID for scoping
   */
  static set<T>(entity: string, data: T, tenantId?: string): void {
    try {
      if (typeof window === 'undefined') return;

      const key = this.getKey(entity, tenantId);
      const json = JSON.stringify(data);
      localStorage.setItem(key, json);
      emitBoStorageChange();
    } catch (err) {
      console.error(`[StorageService] Failed to set ${entity}:`, err);
    }
  }

  /**
   * Get item from localStorage with safe JSON parsing.
   * When defaultValue is provided, returns T; otherwise returns T | null.
   * @param entity - Entity name
   * @param tenantId - Optional tenant ID for scoping
   * @param defaultValue - Default value if key not found or parse fails
   * @returns Parsed object or defaultValue (or null if no default provided)
   */
  static get<T>(entity: string, tenantId?: string): T | null;
  static get<T>(entity: string, tenantId: string | undefined, defaultValue: T): T;
  static get<T>(entity: string, tenantId?: string, defaultValue?: T): T | null {
    try {
      if (typeof window === 'undefined') return defaultValue !== undefined ? defaultValue : null;

      const key = this.getKey(entity, tenantId);
      const json = localStorage.getItem(key);

      if (!json) {
        return defaultValue !== undefined ? defaultValue : null;
      }

      return JSON.parse(json) as T;
    } catch (err) {
      console.error(`[StorageService] Failed to get ${entity}:`, err);
      return defaultValue !== undefined ? defaultValue : null;
    }
  }

  /**
   * Remove item from localStorage.
   * Emits change event for UI updates.
   * @param entity - Entity name
   * @param tenantId - Optional tenant ID for scoping
   */
  static remove(entity: string, tenantId?: string): void {
    try {
      if (typeof window === 'undefined') return;

      const key = this.getKey(entity, tenantId);
      localStorage.removeItem(key);
      emitBoStorageChange();
    } catch (err) {
      console.error(`[StorageService] Failed to remove ${entity}:`, err);
    }
  }

  /**
   * Clear all items matching entity pattern.
   * Useful for clearing all tenant data on logout.
   * @param entity - Entity name (wildcard: bo_entity_*)
   */
  static clearEntity(entity: string): void {
    try {
      if (typeof window === 'undefined') return;

      const prefix = `bo_${entity}_`;
      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key === `bo_${entity}` || key.startsWith(prefix))) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach((key) => localStorage.removeItem(key));

      if (keysToRemove.length > 0) {
        emitBoStorageChange();
      }
    } catch (err) {
      console.error(`[StorageService] Failed to clearEntity ${entity}:`, err);
    }
  }

  /**
   * Clear all storage keys matching a prefix pattern.
   * Used for clearing all app data on logout (bo_*).
   * @param prefix - Key prefix to clear (e.g., 'bo_')
   */
  static clearPrefix(prefix: string): void {
    try {
      if (typeof window === 'undefined') return;

      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach((key) => localStorage.removeItem(key));

      if (keysToRemove.length > 0) {
        emitBoStorageChange();
      }
    } catch (err) {
      console.error(`[StorageService] Failed to clearPrefix ${prefix}:`, err);
    }
  }

  /**
   * Get all keys in localStorage.
   * Useful for debugging and testing.
   * @returns Array of all keys
   */
  static getAllKeys(): string[] {
    try {
      if (typeof window === 'undefined') return [];

      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) keys.push(key);
      }
      return keys;
    } catch (err) {
      console.error('[StorageService] Failed to getAllKeys:', err);
      return [];
    }
  }

  /**
   * Get all storage keys for a specific tenant.
   * Useful for debugging multi-tenant isolation.
   * @param tenantId - Tenant ID
   * @returns Array of keys matching pattern bo_*_<tenantId>
   */
  static getTenantKeys(tenantId: string): string[] {
    try {
      if (typeof window === 'undefined') return [];

      const suffix = `_${tenantId}`;
      const keys: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.endsWith(suffix)) {
          keys.push(key);
        }
      }

      return keys;
    } catch (err) {
      console.error('[StorageService] Failed to getTenantKeys:', err);
      return [];
    }
  }

  /**
   * Clear all storage for a specific tenant.
   * Called on tenant logout or deletion.
   * @param tenantId - Tenant ID to clear
   */
  static clearTenant(tenantId: string): void {
    try {
      if (typeof window === 'undefined') return;

      const suffix = `_${tenantId}`;
      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.endsWith(suffix)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach((key) => localStorage.removeItem(key));

      if (keysToRemove.length > 0) {
        emitBoStorageChange();
      }
    } catch (err) {
      console.error(`[StorageService] Failed to clearTenant ${tenantId}:`, err);
    }
  }
}
