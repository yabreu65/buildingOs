import {
  getPlanLabel,
  getTenantTypeLabel,
  getTenantStatusLabel,
  getStatusBadgeClass,
  formatDate,
  getPlanDescription,
  validateTenantName,
  validateEmail,
  getUsagePercentage,
  isNearLimit,
  sortTenants,
  getTenantSummary,
} from '../super-admin.utils';
import type { Tenant } from '../super-admin.types';

/**
 * Phase 5: SUPER_ADMIN Utilities Tests
 * Tests for formatting, validation, and helper functions
 */

describe('Super Admin Utils - Labels & Formatting', () => {
  describe('getPlanLabel', () => {
    it('should return Spanish label for plan', () => {
      expect(getPlanLabel('FREE')).toBe('Gratuito');
      expect(getPlanLabel('BASIC')).toBe('Básico');
      expect(getPlanLabel('PRO')).toBe('Profesional');
      expect(getPlanLabel('ENTERPRISE')).toBe('Enterprise');
    });

    it('should return original value for unknown plan', () => {
      expect(getPlanLabel('UNKNOWN')).toBe('UNKNOWN');
    });
  });

  describe('getTenantTypeLabel', () => {
    it('should return Spanish label for tenant type', () => {
      expect(getTenantTypeLabel('ADMINISTRADORA')).toBe('Empresa inmobiliaria');
      expect(getTenantTypeLabel('EDIFICIO_AUTOGESTION')).toBe('Consorcio individual');
    });
  });

  describe('getTenantStatusLabel', () => {
    it('should return Spanish label for status', () => {
      expect(getTenantStatusLabel('TRIAL')).toBe('Prueba');
      expect(getTenantStatusLabel('ACTIVE')).toBe('Activo');
      expect(getTenantStatusLabel('SUSPENDED')).toBe('Suspendido');
    });
  });

  describe('getStatusBadgeClass', () => {
    it('should return correct Tailwind classes for status', () => {
      expect(getStatusBadgeClass('ACTIVE')).toBe('bg-green-100 text-green-800');
      expect(getStatusBadgeClass('TRIAL')).toBe('bg-blue-100 text-blue-800');
      expect(getStatusBadgeClass('SUSPENDED')).toBe('bg-red-100 text-red-800');
      expect(getStatusBadgeClass('UNKNOWN')).toBe('bg-gray-100 text-gray-800');
    });
  });

  describe('formatDate', () => {
    it('should format ISO date string to Spanish locale', () => {
      const isoDate = '2026-02-11T10:30:00Z';
      const formatted = formatDate(isoDate);

      expect(formatted).toMatch(/11\/02\/2026/);
    });

    it('should return original string on error', () => {
      const invalidDate = 'invalid-date';
      const formatted = formatDate(invalidDate);

      expect(formatted).toBe('invalid-date');
    });
  });

  describe('getPlanDescription', () => {
    it('should return human-readable plan description', () => {
      expect(getPlanDescription('FREE')).toBe('1 edificio, 10 unidades, 20 usuarios');
      expect(getPlanDescription('BASIC')).toBe('5 edificios, 50 unidades, 100 usuarios');
      expect(getPlanDescription('PRO')).toBe('20 edificios, 500 unidades, 500 usuarios');
      expect(getPlanDescription('ENTERPRISE')).toBe('Ilimitado, soporte personalizado');
    });
  });
});

describe('Super Admin Utils - Validation', () => {
  describe('validateTenantName', () => {
    it('should accept valid tenant name', () => {
      const error = validateTenantName('Valid Tenant Name');
      expect(error).toBeNull();
    });

    it('should reject name shorter than 2 characters', () => {
      const error = validateTenantName('A');
      expect(error).not.toBeNull();
      expect(error).toContain('2 caracteres');
    });

    it('should reject name longer than 100 characters', () => {
      const longName = 'A'.repeat(101);
      const error = validateTenantName(longName);
      expect(error).not.toBeNull();
      expect(error).toContain('100 caracteres');
    });

    it('should reject empty name', () => {
      const error = validateTenantName('');
      expect(error).not.toBeNull();
    });
  });

  describe('validateEmail', () => {
    it('should accept valid email', () => {
      const error = validateEmail('user@example.com');
      expect(error).toBeNull();
    });

    it('should reject email without @', () => {
      const error = validateEmail('userexample.com');
      expect(error).not.toBeNull();
      expect(error).toContain('inválido');
    });

    it('should reject email without domain', () => {
      const error = validateEmail('user@');
      expect(error).not.toBeNull();
    });

    it('should reject email with spaces', () => {
      const error = validateEmail('user @example.com');
      expect(error).not.toBeNull();
    });
  });
});

describe('Super Admin Utils - Usage Calculation', () => {
  describe('getUsagePercentage', () => {
    it('should calculate percentage correctly', () => {
      expect(getUsagePercentage(5, 10)).toBe(50);
      expect(getUsagePercentage(1, 100)).toBe(1);
      expect(getUsagePercentage(100, 100)).toBe(100);
    });

    it('should return 0 when limit is 0', () => {
      expect(getUsagePercentage(5, 0)).toBe(0);
    });

    it('should round to nearest integer', () => {
      expect(getUsagePercentage(1, 3)).toBe(33);
      expect(getUsagePercentage(2, 3)).toBe(67);
    });
  });

  describe('isNearLimit', () => {
    it('should identify when near limit (default 80%)', () => {
      expect(isNearLimit(8, 10)).toBe(true); // 80%
      expect(isNearLimit(7, 10)).toBe(false); // 70%
    });

    it('should use custom threshold', () => {
      expect(isNearLimit(5, 10, 0.5)).toBe(true); // 50% with 50% threshold
      expect(isNearLimit(4, 10, 0.5)).toBe(false); // 40% with 50% threshold
    });

    it('should handle edge case at threshold', () => {
      expect(isNearLimit(8, 10, 0.8)).toBe(true); // Exactly 80%
    });
  });
});

describe('Super Admin Utils - Sorting', () => {
  const mockTenants: Tenant[] = [
    {
      id: '1',
      name: 'Zebra Corp',
      type: 'ADMINISTRADORA',
      status: 'ACTIVE',
      plan: 'PRO',
      createdAt: '2026-02-10T00:00:00Z',
      limits: { buildings: 20, units: 500, users: 500 },
    },
    {
      id: '2',
      name: 'Acme Corp',
      type: 'EDIFICIO_AUTOGESTION',
      status: 'TRIAL',
      plan: 'BASIC',
      createdAt: '2026-02-11T00:00:00Z',
      limits: { buildings: 5, units: 50, users: 100 },
    },
    {
      id: '3',
      name: 'Building Co',
      type: 'ADMINISTRADORA',
      status: 'SUSPENDED',
      plan: 'FREE',
      createdAt: '2026-02-12T00:00:00Z',
      limits: { buildings: 1, units: 10, users: 20 },
    },
  ];

  describe('sortTenants', () => {
    it('should sort by name ascending', () => {
      const sorted = sortTenants(mockTenants, 'name', 'asc');
      expect(sorted[0].name).toBe('Acme Corp');
      expect(sorted[1].name).toBe('Building Co');
      expect(sorted[2].name).toBe('Zebra Corp');
    });

    it('should sort by name descending', () => {
      const sorted = sortTenants(mockTenants, 'name', 'desc');
      expect(sorted[0].name).toBe('Zebra Corp');
      expect(sorted[2].name).toBe('Acme Corp');
    });

    it('should sort by created date ascending', () => {
      const sorted = sortTenants(mockTenants, 'createdAt', 'asc');
      expect(sorted[0].name).toBe('Zebra Corp'); // 2026-02-10
      expect(sorted[2].name).toBe('Building Co'); // 2026-02-12
    });

    it('should sort by status', () => {
      const sorted = sortTenants(mockTenants, 'status', 'asc');
      expect(sorted[0].status).toBe('ACTIVE');
      expect(sorted[2].status).toBe('TRIAL');
    });

    it('should sort by plan', () => {
      const sorted = sortTenants(mockTenants, 'plan', 'asc');
      expect(sorted[0].plan).toBe('BASIC');
      expect(sorted[2].plan).toBe('PRO');
    });

    it('should not mutate original array', () => {
      const original = [...mockTenants];
      sortTenants(mockTenants, 'name', 'desc');
      expect(mockTenants).toEqual(original);
    });
  });
});

describe('Super Admin Utils - Summary', () => {
  const mockTenant: Tenant = {
    id: '1',
    name: 'Test Corp',
    type: 'ADMINISTRADORA',
    status: 'ACTIVE',
    plan: 'PRO',
    createdAt: '2026-02-11T10:30:00Z',
    limits: { buildings: 20, units: 500, users: 500 },
  };

  describe('getTenantSummary', () => {
    it('should generate formatted tenant summary', () => {
      const summary = getTenantSummary(mockTenant);

      expect(summary.typeLabel).toBe('Empresa inmobiliaria');
      expect(summary.statusLabel).toBe('Activo');
      expect(summary.planLabel).toBe('Profesional');
      expect(summary.createdDate).toMatch(/11\/02\/2026/);
    });

    it('should work with all status types', () => {
      const trialTenant = { ...mockTenant, status: 'TRIAL' };
      const summary = getTenantSummary(trialTenant);
      expect(summary.statusLabel).toBe('Prueba');
    });
  });
});
