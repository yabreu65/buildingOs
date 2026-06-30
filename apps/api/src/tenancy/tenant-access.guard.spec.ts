import { ExecutionContext } from '@nestjs/common';
import type { Role } from '@buildingos/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AdminRoleGuard } from '../communications/admin-role.guard';
import { RequestWithUser, TenantAccessGuard } from './tenant-access.guard';

interface MembershipRoleRecord {
  readonly id: string;
  readonly role: Role;
  readonly scopeType: 'TENANT' | 'BUILDING' | 'UNIT';
  readonly scopeBuildingId: string | null;
  readonly scopeUnitId: string | null;
}

interface MembershipRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly roles: MembershipRoleRecord[];
}

interface PrismaMembershipMock {
  readonly findUnique: jest.Mock<Promise<MembershipRecord | null>, [unknown]>;
}

interface PrismaMock {
  readonly membership: PrismaMembershipMock;
}

describe('TenantAccessGuard', () => {
  const tenantAdminRole: MembershipRoleRecord = {
    id: 'role-admin',
    role: 'TENANT_ADMIN',
    scopeType: 'TENANT',
    scopeBuildingId: null,
    scopeUnitId: null,
  };

  const residentRole: MembershipRoleRecord = {
    id: 'role-resident',
    role: 'RESIDENT',
    scopeType: 'TENANT',
    scopeBuildingId: null,
    scopeUnitId: null,
  };

  const buildingOperatorRole: MembershipRoleRecord = {
    id: 'role-building-operator',
    role: 'OPERATOR',
    scopeType: 'BUILDING',
    scopeBuildingId: 'building-1',
    scopeUnitId: null,
  };

  const unitResidentRole: MembershipRoleRecord = {
    id: 'role-unit-resident',
    role: 'RESIDENT',
    scopeType: 'UNIT',
    scopeBuildingId: 'building-1',
    scopeUnitId: 'unit-1',
  };

  let prisma: PrismaMock;
  let tenantAccessGuard: TenantAccessGuard;
  let adminRoleGuard: AdminRoleGuard;

  beforeEach(() => {
    prisma = {
      membership: {
        findUnique: jest.fn(),
      },
    };

    tenantAccessGuard = new TenantAccessGuard(
      prisma as unknown as PrismaService,
    );
    adminRoleGuard = new AdminRoleGuard();
  });

  function buildRequest(tenantId: string): RequestWithUser {
    return {
      params: { tenantId },
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        membershipId: 'membership-tenant-a',
        tenantId: 'tenant-a',
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
    } as RequestWithUser;
  }

  function buildContext(request: RequestWithUser): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;
  }

  it('hydrates effective RBAC context from the requested tenant membership', async () => {
    const request = buildRequest('tenant-b');
    prisma.membership.findUnique.mockResolvedValue({
      id: 'membership-tenant-b',
      tenantId: 'tenant-b',
      roles: [residentRole, buildingOperatorRole],
    });

    await expect(
      tenantAccessGuard.canActivate(buildContext(request)),
    ).resolves.toBe(true);

    expect(prisma.membership.findUnique).toHaveBeenCalledWith({
      where: {
        userId_tenantId: {
          userId: 'user-1',
          tenantId: 'tenant-b',
        },
      },
      include: {
        roles: true,
      },
    });
    expect(request.tenantId).toBe('tenant-b');
    expect(request.user.tenantId).toBe('tenant-b');
    expect(request.user.membershipId).toBe('membership-tenant-b');
    expect(request.user.roles).toEqual(['RESIDENT']);
    expect(request.user.role).toBe('RESIDENT');
    expect(request.user.effectiveMembership).toEqual({
      id: 'membership-tenant-b',
      tenantId: 'tenant-b',
      roles: ['RESIDENT'],
      scopedRoles: [
        {
          id: 'role-resident',
          role: 'RESIDENT',
          scopeType: 'TENANT',
          scopeBuildingId: null,
          scopeUnitId: null,
        },
        {
          id: 'role-building-operator',
          role: 'OPERATOR',
          scopeType: 'BUILDING',
          scopeBuildingId: 'building-1',
          scopeUnitId: null,
        },
      ],
    });
  });

  it('keeps authorization consistent with the requested tenant roles', async () => {
    const adminRequest = buildRequest('tenant-a');
    prisma.membership.findUnique.mockResolvedValueOnce({
      id: 'membership-tenant-a',
      tenantId: 'tenant-a',
      roles: [tenantAdminRole],
    });

    await tenantAccessGuard.canActivate(buildContext(adminRequest));
    expect(adminRoleGuard.canActivate(buildContext(adminRequest))).toBe(true);

    const residentRequest = buildRequest('tenant-b');
    prisma.membership.findUnique.mockResolvedValueOnce({
      id: 'membership-tenant-b',
      tenantId: 'tenant-b',
      roles: [residentRole],
    });

    await tenantAccessGuard.canActivate(buildContext(residentRequest));
    expect(() =>
      adminRoleGuard.canActivate(buildContext(residentRequest)),
    ).toThrow('Only administrators can perform this action');
  });

  it('rejects access when the requested tenant membership does not exist', async () => {
    const request = buildRequest('tenant-c');
    prisma.membership.findUnique.mockResolvedValue(null);

    await expect(
      tenantAccessGuard.canActivate(buildContext(request)),
    ).rejects.toThrow('No tiene acceso al tenant tenant-c');
  });

  it('rejects unauthenticated requests', async () => {
    const request = {
      params: { tenantId: 'tenant-a' },
    } as RequestWithUser;

    await expect(
      tenantAccessGuard.canActivate(buildContext(request)),
    ).rejects.toThrow('Usuario no autenticado');

    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
  });

  it('rejects requests without a tenantId route parameter', async () => {
    const request = buildRequest('tenant-a');
    request.params = {};

    await expect(
      tenantAccessGuard.canActivate(buildContext(request)),
    ).rejects.toThrow('tenantId es requerido en los parámetros');

    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
  });

  it('rejects memberships that only have building or unit scoped roles', async () => {
    const request = buildRequest('tenant-a');
    prisma.membership.findUnique.mockResolvedValue({
      id: 'membership-tenant-a',
      tenantId: 'tenant-a',
      roles: [buildingOperatorRole, unitResidentRole],
    });

    await expect(
      tenantAccessGuard.canActivate(buildContext(request)),
    ).rejects.toThrow('No tiene acceso al tenant tenant-a');
  });

  it('hydrates impersonated tenant context from the synthetic membership', async () => {
    const request = buildRequest('tenant-b');
    request.user.isImpersonating = true;
    request.user.impersonatedTenantId = 'tenant-b';
    request.user.membershipId = '';
    request.user.roles = ['TENANT_ADMIN'];
    request.user.memberships = [
      {
        tenantId: 'tenant-b',
        roles: ['TENANT_ADMIN'],
      },
    ];

    await expect(
      tenantAccessGuard.canActivate(buildContext(request)),
    ).resolves.toBe(true);

    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
    expect(request.tenantId).toBe('tenant-b');
    expect(request.user.tenantId).toBe('tenant-b');
    expect(request.user.roles).toEqual(['TENANT_ADMIN']);
    expect(request.user.role).toBe('TENANT_ADMIN');
  });

  it('rejects impersonation tokens for a different tenant without checking actor membership', async () => {
    const request = buildRequest('tenant-a');
    request.user.isImpersonating = true;
    request.user.impersonatedTenantId = 'tenant-b';
    prisma.membership.findUnique.mockResolvedValue({
      id: 'membership-tenant-a',
      tenantId: 'tenant-a',
      roles: [tenantAdminRole],
    });

    await expect(
      tenantAccessGuard.canActivate(buildContext(request)),
    ).rejects.toThrow('No tiene acceso al tenant tenant-a');

    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
  });
});
