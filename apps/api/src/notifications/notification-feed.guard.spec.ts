import { ExecutionContext } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationFeedAccessGuard } from './notification-feed.guard';
import type { AuthenticatedRequest } from '../common/types/request.types';

interface MembershipRoleRecord {
  readonly id: string;
  readonly role: string;
  readonly scopeType: 'TENANT' | 'BUILDING' | 'UNIT';
  readonly scopeBuildingId: string | null;
  readonly scopeUnitId: string | null;
}

interface MembershipRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly roles: MembershipRoleRecord[];
}

describe('NotificationFeedAccessGuard', () => {
  const tenantRole: MembershipRoleRecord = {
    id: 'role-tenant',
    role: 'TENANT_ADMIN',
    scopeType: 'TENANT',
    scopeBuildingId: null,
    scopeUnitId: null,
  };

  const buildingRole: MembershipRoleRecord = {
    id: 'role-building',
    role: 'OPERATOR',
    scopeType: 'BUILDING',
    scopeBuildingId: 'building-1',
    scopeUnitId: null,
  };

  const unitRole: MembershipRoleRecord = {
    id: 'role-unit',
    role: 'RESIDENT',
    scopeType: 'UNIT',
    scopeBuildingId: 'building-1',
    scopeUnitId: 'unit-1',
  };

  let prisma: {
    membership: {
      findUnique: jest.Mock<Promise<MembershipRecord | null>, [unknown]>;
    };
  };
  let guard: NotificationFeedAccessGuard;

  beforeEach(() => {
    prisma = {
      membership: {
        findUnique: jest.fn(),
      },
    };

    guard = new NotificationFeedAccessGuard(prisma as unknown as PrismaService);
  });

  function buildRequest(tenantId: string): AuthenticatedRequest {
    return {
      params: { tenantId },
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        memberships: [],
      },
    } as AuthenticatedRequest;
  }

  function buildContext(request: AuthenticatedRequest): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;
  }

  it('allows tenant-scoped members to access the notification feed', async () => {
    const request = buildRequest('tenant-a');
    prisma.membership.findUnique.mockResolvedValue({
      id: 'membership-a',
      tenantId: 'tenant-a',
      roles: [tenantRole],
    });

    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
    expect(request.tenantId).toBe('tenant-a');
    expect(request.user.tenantId).toBe('tenant-a');
    expect(request.user.membershipId).toBe('membership-a');
  });

  it('allows building-scoped members to access the notification feed', async () => {
    const request = buildRequest('tenant-a');
    prisma.membership.findUnique.mockResolvedValue({
      id: 'membership-a',
      tenantId: 'tenant-a',
      roles: [buildingRole],
    });

    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
    expect(request.tenantId).toBe('tenant-a');
    expect(request.user.membershipId).toBe('membership-a');
  });

  it('allows unit-scoped members to access the notification feed', async () => {
    const request = buildRequest('tenant-a');
    prisma.membership.findUnique.mockResolvedValue({
      id: 'membership-a',
      tenantId: 'tenant-a',
      roles: [unitRole],
    });

    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
    expect(request.tenantId).toBe('tenant-a');
    expect(request.user.membershipId).toBe('membership-a');
  });

  it('rejects access when membership belongs to another tenant', async () => {
    const request = buildRequest('tenant-b');
    prisma.membership.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(buildContext(request))).rejects.toThrow(
      'No tiene acceso al tenant tenant-b',
    );
  });

  it('rejects access when the user has no membership in the tenant', async () => {
    const request = buildRequest('tenant-a');
    prisma.membership.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(buildContext(request))).rejects.toThrow(
      'No tiene acceso al tenant tenant-a',
    );
  });

  it('rejects access when the request has no authenticated user', async () => {
    const request = {
      params: { tenantId: 'tenant-a' },
    } as AuthenticatedRequest;

    await expect(guard.canActivate(buildContext(request))).rejects.toThrow(
      'Usuario no autenticado',
    );
  });

  it('rejects access when tenantId is missing from the route', async () => {
    const request = buildRequest('tenant-a');
    request.params = {};

    await expect(guard.canActivate(buildContext(request))).rejects.toThrow(
      'tenantId es requerido en los parámetros',
    );
  });
});
