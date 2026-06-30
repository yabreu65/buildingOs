import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedRequest } from '../common/types/request.types';
import { VendorsController } from './vendors.controller';
import { VendorsService } from './vendors.service';
import { VendorsValidators } from './vendors.validators';

interface VendorsServiceMock {
  readonly listVendors: jest.Mock<Promise<readonly unknown[]>, [string]>;
}

describe('VendorsController', () => {
  let vendorsService: VendorsServiceMock;
  let controller: VendorsController;

  beforeEach(() => {
    vendorsService = {
      listVendors: jest.fn().mockResolvedValue([]),
    };

    controller = new VendorsController(
      vendorsService as unknown as VendorsService,
      new VendorsValidators({} as PrismaService),
    );
  });

  function buildRequest(targetTenantId: string): AuthenticatedRequest {
    return {
      headers: {
        'x-tenant-id': targetTenantId,
      },
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        tenantId: 'tenant-a',
        membershipId: 'membership-tenant-a',
        role: 'TENANT_ADMIN',
        roles: ['TENANT_ADMIN'],
        memberships: [
          {
            id: 'membership-tenant-a',
            tenantId: 'tenant-a',
            roles: ['TENANT_ADMIN'],
          },
          {
            id: 'membership-tenant-b',
            tenantId: 'tenant-b',
            roles: ['RESIDENT'],
          },
        ],
      },
    } as AuthenticatedRequest;
  }

  it('overwrites stale JWT roles with the selected tenant membership before RBAC checks', async () => {
    const request = buildRequest('tenant-b');

    await expect(controller.listVendors(request)).rejects.toThrow(
      'You do not have permission to view vendors',
    );

    expect(request.user.tenantId).toBe('tenant-b');
    expect(request.user.membershipId).toBe('membership-tenant-b');
    expect(request.user.roles).toEqual(['RESIDENT']);
    expect(request.user.role).toBe('RESIDENT');
    expect(request.user.effectiveMembership).toEqual({
      id: 'membership-tenant-b',
      tenantId: 'tenant-b',
      roles: ['RESIDENT'],
    });
    expect(vendorsService.listVendors).not.toHaveBeenCalled();
  });

  it('allows vendor access with the selected tenant membership roles', async () => {
    const request = buildRequest('tenant-b');
    request.user.memberships = [
      {
        id: 'membership-tenant-a',
        tenantId: 'tenant-a',
        roles: ['RESIDENT'],
      },
      {
        id: 'membership-tenant-b',
        tenantId: 'tenant-b',
        roles: ['TENANT_OWNER'],
      },
    ];
    vendorsService.listVendors.mockResolvedValue([{ id: 'vendor-1' }]);

    await expect(controller.listVendors(request)).resolves.toEqual([
      { id: 'vendor-1' },
    ]);

    expect(request.user.tenantId).toBe('tenant-b');
    expect(request.user.membershipId).toBe('membership-tenant-b');
    expect(request.user.roles).toEqual(['TENANT_OWNER']);
    expect(request.user.role).toBe('TENANT_OWNER');
    expect(vendorsService.listVendors).toHaveBeenCalledWith('tenant-b');
  });
});
