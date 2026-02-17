import {
  listTenants,
  createTenant,
  updateTenant,
  getTenantById,
  deleteTenant,
  searchTenants,
  filterTenantsByStatus,
  filterTenantsByPlan,
  getTenantsByStatus,
  getRecentTenants,
  validateTenantLimits,
  calculateLimits,
  getGlobalStats,
} from '../tenants.storage';
import type { CreateTenantInput, UpdateTenantInput } from '../super-admin.types';

/**
 * Phase 5: SUPER_ADMIN Storage Layer Tests
 * Tests for CRUD operations, filtering, validation, and statistics
 */

describe('Tenants Storage - CRUD Operations', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  describe('createTenant', () => {
    it('should create a tenant with correct default values', () => {
      const input: CreateTenantInput = {
        name: 'Test Corp',
        type: 'ADMINISTRADORA',
        plan: 'PRO',
        ownerEmail: 'owner@test.com',
      };

      const tenant = createTenant(input);

      expect(tenant.id).toBeDefined();
      expect(tenant.name).toBe('Test Corp');
      expect(tenant.type).toBe('ADMINISTRADORA');
      expect(tenant.plan).toBe('PRO');
      expect(tenant.status).toBe('TRIAL'); // Default status
      expect(tenant.createdAt).toBeDefined();
      expect(tenant.limits).toBeDefined();
    });

    it('should calculate plan limits correctly', () => {
      const freeInput: CreateTenantInput = {
        name: 'Free Tenant',
        type: 'EDIFICIO_AUTOGESTION',
        plan: 'FREE',
        ownerEmail: 'free@test.com',
      };

      const freeTenant = createTenant(freeInput);

      expect(freeTenant.limits.buildings).toBe(1);
      expect(freeTenant.limits.units).toBe(10);
      expect(freeTenant.limits.users).toBe(20);
    });

    it('should trim whitespace from tenant name', () => {
      const input: CreateTenantInput = {
        name: '  Padded Tenant  ',
        type: 'ADMINISTRADORA',
        plan: 'BASIC',
        ownerEmail: 'padded@test.com',
      };

      const tenant = createTenant(input);

      expect(tenant.name).toBe('Padded Tenant');
    });

    it('should add tenant to list and persist in storage', () => {
      const input: CreateTenantInput = {
        name: 'First Tenant',
        type: 'ADMINISTRADORA',
        plan: 'PRO',
        ownerEmail: 'first@test.com',
      };

      createTenant(input);
      const tenants = listTenants();

      expect(tenants.length).toBe(1);
      expect(tenants[0].name).toBe('First Tenant');
    });
  });

  describe('getTenantById', () => {
    it('should return tenant by ID', () => {
      const input: CreateTenantInput = {
        name: 'Test Tenant',
        type: 'ADMINISTRADORA',
        plan: 'PRO',
        ownerEmail: 'test@test.com',
      };

      const created = createTenant(input);
      const fetched = getTenantById(created.id);

      expect(fetched).not.toBeNull();
      expect(fetched?.name).toBe('Test Tenant');
    });

    it('should return null for non-existent tenant', () => {
      const fetched = getTenantById('non-existent-id');
      expect(fetched).toBeNull();
    });
  });

  describe('updateTenant', () => {
    it('should update tenant name', () => {
      const input: CreateTenantInput = {
        name: 'Original Name',
        type: 'ADMINISTRADORA',
        plan: 'PRO',
        ownerEmail: 'test@test.com',
      };

      const tenant = createTenant(input);
      const updateData: UpdateTenantInput = { name: 'Updated Name' };

      const updated = updateTenant(tenant.id, updateData);

      expect(updated.name).toBe('Updated Name');
      expect(updated.type).toBe('ADMINISTRADORA'); // Unchanged
    });

    it('should update tenant status', () => {
      const input: CreateTenantInput = {
        name: 'Test Tenant',
        type: 'ADMINISTRADORA',
        plan: 'PRO',
        ownerEmail: 'test@test.com',
      };

      const tenant = createTenant(input);
      const updated = updateTenant(tenant.id, { status: 'ACTIVE' });

      expect(updated.status).toBe('ACTIVE');
    });

    it('should update plan and recalculate limits', () => {
      const input: CreateTenantInput = {
        name: 'Test Tenant',
        type: 'ADMINISTRADORA',
        plan: 'FREE',
        ownerEmail: 'test@test.com',
      };

      const tenant = createTenant(input);
      const updated = updateTenant(tenant.id, { plan: 'ENTERPRISE' });

      expect(updated.plan).toBe('ENTERPRISE');
      expect(updated.limits.buildings).toBe(999);
      expect(updated.limits.units).toBe(9999);
    });

    it('should throw error for non-existent tenant', () => {
      const updateData: UpdateTenantInput = { name: 'New Name' };

      expect(() => updateTenant('non-existent', updateData)).toThrow();
    });
  });

  describe('deleteTenant', () => {
    it('should delete tenant from list', () => {
      const input: CreateTenantInput = {
        name: 'Tenant to Delete',
        type: 'ADMINISTRADORA',
        plan: 'PRO',
        ownerEmail: 'delete@test.com',
      };

      const tenant = createTenant(input);
      deleteTenant(tenant.id);

      const fetched = getTenantById(tenant.id);
      expect(fetched).toBeNull();
    });
  });
});

describe('Tenants Storage - Search & Filter', () => {
  beforeEach(() => {
    localStorage.clear();

    // Create test data
    const tenants: CreateTenantInput[] = [
      {
        name: 'Acme Corp',
        type: 'ADMINISTRADORA',
        plan: 'PRO',
        ownerEmail: 'acme@test.com',
      },
      {
        name: 'Building Heights',
        type: 'EDIFICIO_AUTOGESTION',
        plan: 'BASIC',
        ownerEmail: 'building@test.com',
      },
      {
        name: 'Tower Complex',
        type: 'ADMINISTRADORA',
        plan: 'ENTERPRISE',
        ownerEmail: 'tower@test.com',
      },
    ];

    tenants.forEach((t) => createTenant(t));
    // Update status for second tenant to test filtering
    updateTenant(listTenants()[1].id, { status: 'ACTIVE' });
  });

  describe('searchTenants', () => {
    it('should find tenant by partial name match', () => {
      const results = searchTenants('acme');
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Acme Corp');
    });

    it('should be case-insensitive', () => {
      const results = searchTenants('BUILDING');
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Building Heights');
    });

    it('should return all tenants with empty query', () => {
      const results = searchTenants('');
      expect(results.length).toBe(3);
    });

    it('should return empty array for no matches', () => {
      const results = searchTenants('NonExistent');
      expect(results.length).toBe(0);
    });
  });

  describe('filterTenantsByStatus', () => {
    it('should filter tenants by ACTIVE status', () => {
      const results = filterTenantsByStatus('ACTIVE');
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Building Heights');
    });

    it('should filter tenants by TRIAL status', () => {
      const results = filterTenantsByStatus('TRIAL');
      expect(results.length).toBe(2); // Acme and Tower are TRIAL
    });

    it('should return empty for non-existent status', () => {
      const results = filterTenantsByStatus('SUSPENDED');
      expect(results.length).toBe(0);
    });
  });

  describe('filterTenantsByPlan', () => {
    it('should filter tenants by plan', () => {
      const results = filterTenantsByPlan('PRO');
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Acme Corp');
    });

    it('should return multiple tenants with same plan', () => {
      const results = filterTenantsByPlan('BASIC');
      expect(results.length).toBe(1);
    });
  });

  describe('getTenantsByStatus', () => {
    it('should return tenants grouped by status', () => {
      const grouped = getTenantsByStatus();

      expect(grouped.ACTIVE.length).toBe(1);
      expect(grouped.TRIAL.length).toBe(2);
      expect(grouped.SUSPENDED.length).toBe(0);
    });
  });

  describe('getRecentTenants', () => {
    it('should return most recent tenants', () => {
      const recent = getRecentTenants(2);
      expect(recent.length).toBe(2);

      // Most recent should be last created (Tower Complex)
      expect(recent[0].name).toBe('Tower Complex');
    });

    it('should respect limit parameter', () => {
      const recent = getRecentTenants(1);
      expect(recent.length).toBe(1);
    });
  });
});

describe('Tenants Storage - Validation & Statistics', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('validateTenantLimits', () => {
    it('should allow building creation within plan limit', () => {
      const input: CreateTenantInput = {
        name: 'Test Tenant',
        type: 'ADMINISTRADORA',
        plan: 'PRO',
        ownerEmail: 'test@test.com',
      };

      const tenant = createTenant(input);
      const canCreate = validateTenantLimits(tenant.id, 'building');

      expect(canCreate).toBe(true); // PRO has 20 buildings limit
    });

    it('should return false for non-existent tenant', () => {
      const canCreate = validateTenantLimits('non-existent', 'building');
      expect(canCreate).toBe(false);
    });
  });

  describe('calculateLimits', () => {
    it('should calculate correct limits for each plan', () => {
      const freeLimits = calculateLimits('FREE');
      expect(freeLimits.buildings).toBe(1);
      expect(freeLimits.units).toBe(10);
      expect(freeLimits.users).toBe(20);

      const basicLimits = calculateLimits('BASIC');
      expect(basicLimits.buildings).toBe(5);
      expect(basicLimits.units).toBe(50);
      expect(basicLimits.users).toBe(100);

      const proLimits = calculateLimits('PRO');
      expect(proLimits.buildings).toBe(20);
      expect(proLimits.units).toBe(500);
      expect(proLimits.users).toBe(500);

      const enterpriseLimits = calculateLimits('ENTERPRISE');
      expect(enterpriseLimits.buildings).toBe(999);
      expect(enterpriseLimits.units).toBe(9999);
      expect(enterpriseLimits.users).toBe(9999);
    });
  });

  describe('getGlobalStats', () => {
    it('should calculate correct global statistics', () => {
      const inputs: CreateTenantInput[] = [
        {
          name: 'Tenant 1',
          type: 'ADMINISTRADORA',
          plan: 'PRO',
          ownerEmail: 'tenant1@test.com',
        },
        {
          name: 'Tenant 2',
          type: 'EDIFICIO_AUTOGESTION',
          plan: 'BASIC',
          ownerEmail: 'tenant2@test.com',
        },
      ];

      inputs.forEach((input) => {
        const tenant = createTenant(input);
        if (input.name === 'Tenant 2') {
          updateTenant(tenant.id, { status: 'ACTIVE' });
        }
      });

      const stats = getGlobalStats();

      expect(stats.totalTenants).toBe(2);
      expect(stats.activeTenants).toBe(1);
      expect(stats.trialTenants).toBe(1);
      expect(stats.suspendedTenants).toBe(0);
    });

    it('should return zero stats with no tenants', () => {
      const stats = getGlobalStats();

      expect(stats.totalTenants).toBe(0);
      expect(stats.activeTenants).toBe(0);
      expect(stats.trialTenants).toBe(0);
    });
  });
});
