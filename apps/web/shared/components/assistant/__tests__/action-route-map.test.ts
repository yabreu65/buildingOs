/**
 * Action Route Map Tests
 * Verifica la lógica de navegación del assistant
 */

import {
  getAssistantActionPath,
  isAssistantActionMapped,
  getAvailableActions,
  ACTION_ROUTE_MAP,
} from '../action-route-map';

describe('action-route-map', () => {
  describe('getAssistantActionPath', () => {
    const testCases = [
      { actionKey: 'open-buildings', tenantId: 'tenant_123', expected: '/tenant_123/buildings' },
      { actionKey: 'open-units', tenantId: 'tenant_456', expected: '/tenant_456/units' },
      { actionKey: 'open-charges', tenantId: 'tenant_789', expected: '/tenant_789/finanzas?tab=charges' },
      { actionKey: 'open-payments', tenantId: 'tenant_abc', expected: '/tenant_abc/finanzas?tab=payments' },
      { actionKey: 'open-payments-review', tenantId: 'tenant_xyz', expected: '/tenant_xyz/payments/review' },
      { actionKey: 'review-generated-charges', tenantId: 't1', expected: '/t1/finanzas?tab=charges' },
      { actionKey: 'publish-charges', tenantId: 't2', expected: '/t2/finanzas?tab=charges' },
      { actionKey: 'view-my-charges', tenantId: 't3', expected: '/t3/finanzas?tab=charges' },
      { actionKey: 'check-my-payment-status', tenantId: 't4', expected: '/t4/finanzas?tab=payments' },
      { actionKey: 'review-pending-payments', tenantId: 't5', expected: '/t5/payments/review' },
    ];

    testCases.forEach(({ actionKey, tenantId, expected }) => {
      it(`should return correct path for ${actionKey}`, () => {
        const result = getAssistantActionPath(actionKey, tenantId);
        expect(result).toBe(expected);
      });
    });

    it('should return null for unknown action key', () => {
      const result = getAssistantActionPath('unknown-action', 'tenant_123');
      expect(result).toBeNull();
    });

    it('should return null for action key that is not in the map', () => {
      const result = getAssistantActionPath('open-reports', 'tenant_123');
      expect(result).toBeNull();
    });

    it('should handle empty tenantId', () => {
      const result = getAssistantActionPath('open-buildings', '');
      expect(result).toBe('//buildings');
    });

    it('should handle undefined tenantId gracefully', () => {
      const result = getAssistantActionPath('open-units', undefined as unknown as string);
      expect(result).toBe('/undefined/units');
    });

    it('should handle special characters in tenantId', () => {
      const result = getAssistantActionPath('open-charges', 'tenant-with-dashes');
      expect(result).toBe('/tenant-with-dashes/finanzas?tab=charges');
    });
  });

  describe('isAssistantActionMapped', () => {
    const knownActions = [
      'open-buildings',
      'open-units',
      'open-charges',
      'open-payments',
      'open-payments-review',
      'review-generated-charges',
      'publish-charges',
      'view-my-charges',
      'check-my-payment-status',
      'review-pending-payments',
    ];

    knownActions.forEach((action) => {
      it(`should return true for known action: ${action}`, () => {
        expect(isAssistantActionMapped(action)).toBe(true);
      });
    });

    it('should return false for unknown action', () => {
      expect(isAssistantActionMapped('unknown-action')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isAssistantActionMapped('')).toBe(false);
    });

    it('should return false for action not in the map', () => {
      expect(isAssistantActionMapped('open-reports')).toBe(false);
      expect(isAssistantActionMapped('open-tickets')).toBe(false);
    });
  });

  describe('getAvailableActions', () => {
    it('should return a non-empty array', () => {
      const result = getAvailableActions();
      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return actions with key and label properties', () => {
      const result = getAvailableActions();
      result.forEach((action) => {
        expect(action).toHaveProperty('key');
        expect(action).toHaveProperty('label');
        expect(typeof action.key).toBe('string');
        expect(typeof action.label).toBe('string');
      });
    });

    it('should have no duplicate keys', () => {
      const result = getAvailableActions();
      const keys = result.map((a) => a.key);
      const uniqueKeys = new Set(keys);
      expect(keys.length).toBe(uniqueKeys.size);
    });

    it('should contain all keys from ACTION_ROUTE_MAP', () => {
      const result = getAvailableActions();
      const resultKeys = result.map((a) => a.key);
      const mapKeys = Object.keys(ACTION_ROUTE_MAP);
      expect(resultKeys).toEqual(expect.arrayContaining(mapKeys));
    });

    it('should have correct number of actions matching the map', () => {
      const result = getAvailableActions();
      expect(result.length).toBe(Object.keys(ACTION_ROUTE_MAP).length);
    });
  });

  describe('ACTION_ROUTE_MAP', () => {
    it('should have all expected action keys', () => {
      const expectedKeys = [
        'open-buildings',
        'open-units',
        'open-charges',
        'open-payments',
        'open-payments-review',
        'review-generated-charges',
        'publish-charges',
        'view-my-charges',
        'check-my-payment-status',
        'review-pending-payments',
      ];
      const actualKeys = Object.keys(ACTION_ROUTE_MAP);
      expect(actualKeys).toEqual(expectedKeys);
    });

    it('should have resolver functions for all keys', () => {
      Object.entries(ACTION_ROUTE_MAP).forEach(([key, resolver]) => {
        expect(typeof resolver).toBe('function');
        const result = resolver('test_tenant');
        expect(typeof result).toBe('string');
        expect(result).toContain('test_tenant');
      });
    });
  });
});