import { AiCacheService } from './cache.service';

describe('AiCacheService security-scoped keys', () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  let service: AiCacheService;

  beforeEach(() => {
    service = new AiCacheService();
  });

  it('does not share cache keys between admin and resident in same tenant/context/message', () => {
    const adminKey = service.generateKey('tenant-1', 'Cuanto debe A-0101', 'dashboard', 'b1', undefined, {
      membershipId: 'membership-admin',
      userRoles: ['TENANT_ADMIN'],
    });
    const residentKey = service.generateKey('tenant-1', 'Cuanto debe A-0101', 'dashboard', 'b1', undefined, {
      membershipId: 'membership-resident',
      userRoles: ['RESIDENT'],
    });

    expect(adminKey).not.toBe(residentKey);
  });

  it('normalizes role ordering but separates memberships', () => {
    const firstKey = service.generateKey('tenant-1', 'tickets abiertos', 'dashboard', 'b1', undefined, {
      membershipId: 'membership-1',
      userRoles: ['OPERATOR', 'TENANT_ADMIN'],
    });
    const sameScopeKey = service.generateKey('tenant-1', 'tickets abiertos', 'dashboard', 'b1', undefined, {
      membershipId: 'membership-1',
      userRoles: ['TENANT_ADMIN', 'OPERATOR'],
    });
    const differentMembershipKey = service.generateKey('tenant-1', 'tickets abiertos', 'dashboard', 'b1', undefined, {
      membershipId: 'membership-2',
      userRoles: ['TENANT_ADMIN', 'OPERATOR'],
    });

    expect(firstKey).toBe(sameScopeKey);
    expect(firstKey).not.toBe(differentMembershipKey);
  });
});
