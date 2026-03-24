/**
 * StorageService Tests
 * Verifies type-safe storage operations with validation and event handling
 */

import { StorageService } from '../storage.service';
import { safeParseArray, normalize, isValidString } from '../storage.validation';

describe('StorageService', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  describe('getKey()', () => {
    it('should generate global key without tenantId', () => {
      const key = StorageService.getKey('token');
      expect(key).toBe('bo_token');
    });

    it('should generate tenant-scoped key with tenantId', () => {
      const key = StorageService.getKey('buildings', 'tenant_1');
      expect(key).toBe('bo_buildings_tenant_1');
    });
  });

  describe('set() / get()', () => {
    it('should set and get global data', () => {
      const token = 'jwt_token_here';
      StorageService.set('token', token);

      const result = StorageService.get<string>('token');
      expect(result).toBe(token);
    });

    it('should set and get tenant-scoped data', () => {
      const buildings = [
        { id: 'b1', name: 'Building 1', tenantId: 'tenant_1' },
        { id: 'b2', name: 'Building 2', tenantId: 'tenant_1' },
      ];

      StorageService.set('buildings', buildings, 'tenant_1');
      const result = StorageService.get<typeof buildings>('buildings', 'tenant_1');
      expect(result).toEqual(buildings);
    });

    it('should return null when key not found and no default provided', () => {
      const result = StorageService.get<string>('nonexistent');
      expect(result).toBeNull();
    });

    it('should return default value when key not found', () => {
      const result = StorageService.get<string[]>('buildings', 'tenant_1', []);
      expect(result).toEqual([]);
    });

    it('should return default value on parse error', () => {
      localStorage.setItem('bo_buildings_tenant_1', '{invalid json');
      const result = StorageService.get<any[]>('buildings', 'tenant_1', []);
      expect(result).toEqual([]);
    });

    it('should handle null values', () => {
      StorageService.set('value', null);
      const result = StorageService.get<null>('value');
      expect(result).toBeNull();
    });

    it('should handle object values', () => {
      const obj = { id: '1', name: 'Test', nested: { field: 'value' } };
      StorageService.set('obj', obj);
      const result = StorageService.get<typeof obj>('obj');
      expect(result).toEqual(obj);
    });
  });

  describe('remove()', () => {
    it('should remove item from storage', () => {
      StorageService.set('token', 'jwt');
      expect(StorageService.get<string>('token')).toBe('jwt');

      StorageService.remove('token');
      expect(StorageService.get<string>('token')).toBeNull();
    });

    it('should remove tenant-scoped item', () => {
      StorageService.set('buildings', [{ id: 'b1' }], 'tenant_1');
      StorageService.remove('buildings', 'tenant_1');

      const result = StorageService.get<any>('buildings', 'tenant_1', []);
      expect(result).toEqual([]);
    });
  });

  describe('clearEntity()', () => {
    it('should clear all items for an entity across all tenants', () => {
      StorageService.set('buildings', [{ id: 'b1' }], 'tenant_1');
      StorageService.set('buildings', [{ id: 'b2' }], 'tenant_2');
      StorageService.set('units', [{ id: 'u1' }], 'tenant_1');

      StorageService.clearEntity('buildings');

      expect(StorageService.get<any>('buildings', 'tenant_1', [])).toEqual([]);
      expect(StorageService.get<any>('buildings', 'tenant_2', [])).toEqual([]);
      expect(StorageService.get<any>('units', 'tenant_1', [])).toEqual([{ id: 'u1' }]);
    });
  });

  describe('clearTenant()', () => {
    it('should clear all data for a specific tenant', () => {
      StorageService.set('buildings', [{ id: 'b1' }], 'tenant_1');
      StorageService.set('units', [{ id: 'u1' }], 'tenant_1');
      StorageService.set('buildings', [{ id: 'b2' }], 'tenant_2');

      StorageService.clearTenant('tenant_1');

      expect(StorageService.get<any>('buildings', 'tenant_1', [])).toEqual([]);
      expect(StorageService.get<any>('units', 'tenant_1', [])).toEqual([]);
      expect(StorageService.get<any>('buildings', 'tenant_2', [])).toEqual([{ id: 'b2' }]);
    });
  });

  describe('clearPrefix()', () => {
    it('should clear all keys matching prefix', () => {
      StorageService.set('token', 'jwt');
      StorageService.set('buildings', [{ id: 'b1' }], 'tenant_1');
      localStorage.setItem('other_key', 'value');

      StorageService.clearPrefix('bo_');

      expect(StorageService.get<string>('token')).toBeNull();
      expect(StorageService.get<any>('buildings', 'tenant_1', [])).toEqual([]);
      expect(localStorage.getItem('other_key')).toBe('value');
    });
  });

  describe('getTenantKeys()', () => {
    it('should get all keys for a tenant', () => {
      StorageService.set('buildings', [{ id: 'b1' }], 'tenant_1');
      StorageService.set('units', [{ id: 'u1' }], 'tenant_1');
      StorageService.set('buildings', [{ id: 'b2' }], 'tenant_2');

      const keys = StorageService.getTenantKeys('tenant_1');
      expect(keys).toContain('bo_buildings_tenant_1');
      expect(keys).toContain('bo_units_tenant_1');
      expect(keys).not.toContain('bo_buildings_tenant_2');
    });
  });

  describe('Multi-tenant isolation', () => {
    it('should isolate data by tenant', () => {
      const t1Buildings = [{ id: 'b1', name: 'T1 Building' }];
      const t2Buildings = [{ id: 'b2', name: 'T2 Building' }];

      StorageService.set('buildings', t1Buildings, 'tenant_1');
      StorageService.set('buildings', t2Buildings, 'tenant_2');

      const result1 = StorageService.get<typeof t1Buildings>('buildings', 'tenant_1');
      const result2 = StorageService.get<typeof t2Buildings>('buildings', 'tenant_2');

      expect(result1).toEqual(t1Buildings);
      expect(result2).toEqual(t2Buildings);
      expect(result1).not.toEqual(result2);
    });
  });

  describe('Type safety', () => {
    it('should maintain type with default value', () => {
      const result = StorageService.get('nonexistent', undefined, [] as string[]);
      expect(result).toEqual([]);
      // If defaultValue is provided, type is T, not T | null
      const typed: string[] = result;
      expect(typed).toBeDefined();
    });

    it('should allow null without default value', () => {
      const result = StorageService.get<string>('nonexistent');
      expect(result).toBeNull();
      // Without defaultValue, type is T | null
      const typed: string | null = result;
      expect(typed).toBeDefined();
    });
  });
});

describe('Storage Validation Helpers', () => {
  describe('safeParseArray()', () => {
    it('should parse JSON string array', () => {
      const result = safeParseArray<any>('[{"id":"1"}]');
      expect(result).toEqual([{ id: '1' }]);
    });

    it('should return empty array on null', () => {
      const result = safeParseArray<any>(null);
      expect(result).toEqual([]);
    });

    it('should return empty array on undefined', () => {
      const result = safeParseArray<any>(undefined);
      expect(result).toEqual([]);
    });

    it('should return empty array on parse error', () => {
      const result = safeParseArray<any>('{invalid json');
      expect(result).toEqual([]);
    });

    it('should return empty array for non-array JSON', () => {
      const result = safeParseArray<any>('{"not":"array"}');
      expect(result).toEqual([]);
    });

    it('should handle array directly', () => {
      const arr = [{ id: '1' }];
      const result = safeParseArray<any>(arr);
      expect(result).toEqual(arr);
    });
  });

  describe('normalize()', () => {
    it('should trim and lowercase', () => {
      expect(normalize('  HELLO WORLD  ')).toBe('hello world');
    });

    it('should handle empty string', () => {
      expect(normalize('')).toBe('');
    });

    it('should handle undefined', () => {
      expect(normalize(undefined)).toBe('');
    });
  });

  describe('isValidString()', () => {
    it('should return true for non-empty string', () => {
      expect(isValidString('hello')).toBe(true);
    });

    it('should return false for empty string', () => {
      expect(isValidString('')).toBe(false);
    });

    it('should return false for whitespace-only string', () => {
      expect(isValidString('   ')).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidString(undefined)).toBe(false);
    });
  });
});
