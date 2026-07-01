import type {
  INestApplication,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import type { Role } from '@buildingos/contracts';
import type { AuthenticatedRequest } from '../common/types/request.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { BuildingsController } from '../buildings/buildings.controller';
import { BuildingsService } from '../buildings/buildings.service';
import { TenantMembersController } from '../tenant-members/tenant-members.controller';
import { TenantMembersService } from '../tenant-members/tenant-members.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPermissionGuard } from './tenant-permission.guard';

interface ProtectedRouteCase {
  readonly label: string;
  readonly method: 'post';
  readonly path: string;
  readonly body: Record<string, string>;
  readonly service: jest.Mock;
}

interface TenantAccessMembershipRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly roles: readonly {
    readonly id: string;
    readonly role: Role;
    readonly scopeType: 'TENANT';
    readonly scopeBuildingId: null;
    readonly scopeUnitId: null;
  }[];
}

describe('Tenant permission protected routes', () => {
  let app: INestApplication;
  let httpServer: Server;
  let rolesForRequest: Role[] = ['TENANT_OWNER'];
  let hydratedTenantId: string | undefined = 'tenant-a';

  const buildingsService = {
    create: jest.fn(),
  } satisfies Pick<BuildingsService, 'create'>;

  const tenantMembersService = {
    createMember: jest.fn(),
  } satisfies Pick<TenantMembersService, 'createMember'>;

  const prismaService = {
    membership: {
      findUnique: jest.fn<Promise<TenantAccessMembershipRecord>, [unknown]>(),
    },
  };

  const jwtGuard: CanActivate = {
    canActivate: (context: ExecutionContext): boolean => {
      const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
      req.user = {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        roles: rolesForRequest,
        memberships: [],
      };
      return true;
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BuildingsController, TenantMembersController],
      providers: [
        TenantPermissionGuard,
        TenantAccessGuard,
        { provide: PrismaService, useValue: prismaService },
        { provide: BuildingsService, useValue: buildingsService },
        { provide: TenantMembersService, useValue: tenantMembersService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(jwtGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  beforeEach(() => {
    rolesForRequest = ['TENANT_OWNER'];
    hydratedTenantId = 'tenant-a';
    prismaService.membership.findUnique.mockImplementation(() =>
      Promise.resolve(buildTenantMembership(hydratedTenantId, rolesForRequest)),
    );
    buildingsService.create.mockResolvedValue({ id: 'building-1' });
    tenantMembersService.createMember.mockResolvedValue({ id: 'member-1' });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app?.close();
  });

  function buildTenantMembership(
    tenantId: string | undefined,
    roles: readonly Role[],
  ): TenantAccessMembershipRecord {
    return {
      id: 'membership-1',
      tenantId: tenantId ?? 'tenant-a',
      roles: roles.map((role) => ({
        id: `role-${role}`,
        role,
        scopeType: 'TENANT',
        scopeBuildingId: null,
        scopeUnitId: null,
      })),
    };
  }

  const protectedRoutes: readonly ProtectedRouteCase[] = [
    {
      label: 'members.manage endpoint',
      method: 'post',
      path: '/tenants/tenant-a/members',
      body: {
        name: 'Resident One',
        email: 'resident@example.com',
        phone: '+15550000001',
      },
      service: tenantMembersService.createMember,
    },
    {
      label: 'buildings.write endpoint',
      method: 'post',
      path: '/tenants/tenant-a/buildings',
      body: {
        name: 'North Tower',
      },
      service: buildingsService.create,
    },
  ];

  it.each(protectedRoutes)(
    'allows tenant owners and tenant admins through the real guard chain for $label',
    async ({ method, path, body, service }) => {
      for (const role of ['TENANT_OWNER', 'TENANT_ADMIN'] satisfies Role[]) {
        rolesForRequest = [role];

        await request(httpServer)[method](path).send(body).expect(201);
      }

      expect(service).toHaveBeenCalledTimes(2);
    },
  );

  it.each(protectedRoutes)(
    'denies operators and residents with 403 through the real guard chain for $label',
    async ({ method, path, body, service }) => {
      for (const role of ['OPERATOR', 'RESIDENT'] satisfies Role[]) {
        rolesForRequest = [role];

        await request(httpServer)[method](path).send(body).expect(403);
      }

      expect(service).not.toHaveBeenCalled();
    },
  );

  it.each(protectedRoutes)(
    'denies tenant mismatch before the controller handles $label',
    async ({ method, path, body, service }) => {
      rolesForRequest = ['TENANT_OWNER'];
      hydratedTenantId = 'tenant-b';

      await request(httpServer)[method](path).send(body).expect(403);

      expect(service).not.toHaveBeenCalled();
    },
  );
});
