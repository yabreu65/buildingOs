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
import { InvitationsAdminController } from '../invitations/invitations.controller';
import { InvitationsService } from '../invitations/invitations.service';
import { MembershipsController } from '../memberships/memberships.controller';
import { MembershipsService } from '../memberships/memberships.service';
import { TenantMembersController } from '../tenant-members/tenant-members.controller';
import { TenantMembersService } from '../tenant-members/tenant-members.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPermissionGuard } from './tenant-permission.guard';

jest.mock('@buildingos/contracts', () => ({
  Role: {
    SUPER_ADMIN: 'SUPER_ADMIN',
    TENANT_OWNER: 'TENANT_OWNER',
    TENANT_ADMIN: 'TENANT_ADMIN',
    OPERATOR: 'OPERATOR',
    RESIDENT: 'RESIDENT',
  },
}));

jest.mock('../buildings/buildings.service', () => ({
  BuildingsService: class BuildingsService {},
}));

jest.mock('../invitations/invitations.service', () => ({
  InvitationsService: class InvitationsService {},
}));

jest.mock('../memberships/memberships.service', () => ({
  MembershipsService: class MembershipsService {},
}));

jest.mock('../tenant-members/tenant-members.service', () => ({
  TenantMembersService: class TenantMembersService {},
}));

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

interface ProtectedRouteCase {
  readonly label: string;
  readonly method: 'get' | 'post';
  readonly path: string;
  readonly body?: Record<string, string>;
  readonly service: jest.Mock;
  readonly allowedRoles: readonly Role[];
  readonly deniedRoles: readonly Role[];
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
  let forceUnknownRole = false;
  let hydratedTenantId: string | undefined = 'tenant-a';

  const buildingsService = {
    create: jest.fn(),
  } satisfies Pick<BuildingsService, 'create'>;

  const membershipsService = {
    getAssignableResidents: jest.fn(),
    getAssignableTicketMembers: jest.fn(),
    getRoles: jest.fn(),
  } satisfies Pick<
    MembershipsService,
    'getAssignableResidents' | 'getAssignableTicketMembers' | 'getRoles'
  >;

  const invitationsService = {
    createInvitation: jest.fn(),
    listMembers: jest.fn(),
    listInvitations: jest.fn(),
    revokeInvitation: jest.fn(),
    resendInvitation: jest.fn(),
  } satisfies Pick<
    InvitationsService,
    'createInvitation' | 'listMembers' | 'listInvitations' | 'revokeInvitation' | 'resendInvitation'
  >;

  const tenantMembersService = {
    createMember: jest.fn(),
    deleteMember: jest.fn(),
    inviteMember: jest.fn(),
    listMembers: jest.fn(),
    getMember: jest.fn(),
    getAssignableResidents: jest.fn(),
    updateMember: jest.fn(),
  } satisfies Pick<
    TenantMembersService,
    | 'createMember'
    | 'deleteMember'
    | 'inviteMember'
    | 'listMembers'
    | 'getMember'
    | 'getAssignableResidents'
    | 'updateMember'
  >;

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
      if (forceUnknownRole) {
        Reflect.set(req.user, 'roles', ['UNKNOWN_ROLE']);
      }
      return true;
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        BuildingsController,
        InvitationsAdminController,
        MembershipsController,
        TenantMembersController,
      ],
      providers: [
        TenantPermissionGuard,
        TenantAccessGuard,
        { provide: PrismaService, useValue: prismaService },
        { provide: BuildingsService, useValue: buildingsService },
        { provide: MembershipsService, useValue: membershipsService },
        { provide: InvitationsService, useValue: invitationsService },
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
    tenantMembersService.listMembers.mockResolvedValue([{ id: 'member-1' }]);
    tenantMembersService.getMember.mockResolvedValue({ id: 'member-1' });
    tenantMembersService.getAssignableResidents.mockResolvedValue([{ id: 'member-1' }]);
    membershipsService.getAssignableResidents.mockResolvedValue([{ id: 'member-1' }]);
    membershipsService.getAssignableTicketMembers.mockResolvedValue([{ id: 'member-1' }]);
    membershipsService.getRoles.mockResolvedValue([{ id: 'role-1' }]);
    invitationsService.listMembers.mockResolvedValue([{ id: 'member-1' }]);
    invitationsService.listInvitations.mockResolvedValue([{ id: 'invite-1' }]);
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
      label: 'tenant members list',
      method: 'get',
      path: '/tenants/tenant-a/members',
      service: tenantMembersService.listMembers,
      allowedRoles: ['TENANT_OWNER', 'TENANT_ADMIN'],
      deniedRoles: ['OPERATOR', 'RESIDENT'],
    },
    {
      label: 'tenant member update',
      method: 'patch',
      path: '/tenants/tenant-a/members/member-1',
      body: {
        name: 'Resident One Updated',
      },
      service: tenantMembersService.updateMember,
      allowedRoles: ['TENANT_OWNER', 'TENANT_ADMIN'],
      deniedRoles: ['OPERATOR', 'RESIDENT'],
    },
    {
      label: 'tenant member invite',
      method: 'post',
      path: '/tenants/tenant-a/members/member-1/invite',
      body: {
        force: 'true',
      },
      service: tenantMembersService.inviteMember,
      allowedRoles: ['TENANT_OWNER', 'TENANT_ADMIN'],
      deniedRoles: ['OPERATOR', 'RESIDENT'],
    },
    {
      label: 'tenant member delete',
      method: 'delete',
      path: '/tenants/tenant-a/members/member-1',
      service: tenantMembersService.deleteMember,
      allowedRoles: ['TENANT_OWNER', 'TENANT_ADMIN'],
      deniedRoles: ['OPERATOR', 'RESIDENT'],
    },
    {
      label: 'tenant member detail',
      method: 'get',
      path: '/tenants/tenant-a/members/member-1',
      service: tenantMembersService.getMember,
      allowedRoles: ['TENANT_OWNER', 'TENANT_ADMIN'],
      deniedRoles: ['OPERATOR', 'RESIDENT'],
    },
    {
      label: 'tenant assignable residents',
      method: 'get',
      path: '/tenants/tenant-a/members/assignable',
      service: tenantMembersService.getAssignableResidents,
      allowedRoles: ['TENANT_OWNER', 'TENANT_ADMIN'],
      deniedRoles: ['OPERATOR', 'RESIDENT'],
    },
    {
      label: 'membership assignable residents',
      method: 'get',
      path: '/tenants/tenant-a/memberships/assignable-residents',
      service: membershipsService.getAssignableResidents,
      allowedRoles: ['TENANT_OWNER', 'TENANT_ADMIN'],
      deniedRoles: ['OPERATOR', 'RESIDENT'],
    },
    {
      label: 'membership assignable ticket members',
      method: 'get',
      path: '/tenants/tenant-a/memberships/assignable-tickets',
      service: membershipsService.getAssignableTicketMembers,
      allowedRoles: ['TENANT_OWNER', 'TENANT_ADMIN', 'OPERATOR'],
      deniedRoles: ['RESIDENT'],
    },
    {
      label: 'membership roles directory',
      method: 'get',
      path: '/tenants/tenant-a/memberships/membership-1/roles',
      service: membershipsService.getRoles,
      allowedRoles: ['TENANT_OWNER', 'TENANT_ADMIN'],
      deniedRoles: ['OPERATOR', 'RESIDENT'],
    },
    {
      label: 'tenant memberships list',
      method: 'get',
      path: '/tenants/tenant-a/memberships',
      service: invitationsService.listMembers,
      allowedRoles: ['TENANT_OWNER', 'TENANT_ADMIN'],
      deniedRoles: ['OPERATOR', 'RESIDENT'],
    },
    {
      label: 'tenant invitations list',
      method: 'get',
      path: '/tenants/tenant-a/memberships/invitations',
      service: invitationsService.listInvitations,
      allowedRoles: ['TENANT_OWNER', 'TENANT_ADMIN'],
      deniedRoles: ['OPERATOR', 'RESIDENT'],
    },
    {
      label: 'tenant invitation create',
      method: 'post',
      path: '/tenants/tenant-a/memberships/invitations',
      body: {
        email: 'resident@example.com',
        roles: ['RESIDENT'],
      },
      service: invitationsService.createInvitation,
      allowedRoles: ['TENANT_OWNER', 'TENANT_ADMIN'],
      deniedRoles: ['OPERATOR', 'RESIDENT'],
    },
    {
      label: 'tenant invitation revoke',
      method: 'delete',
      path: '/tenants/tenant-a/memberships/invitations/invite-1',
      service: invitationsService.revokeInvitation,
      allowedRoles: ['TENANT_OWNER', 'TENANT_ADMIN'],
      deniedRoles: ['OPERATOR', 'RESIDENT'],
    },
    {
      label: 'tenant invitation resend',
      method: 'post',
      path: '/tenants/tenant-a/memberships/invitations/invite-1/resend',
      service: invitationsService.resendInvitation,
      allowedRoles: ['TENANT_OWNER', 'TENANT_ADMIN'],
      deniedRoles: ['OPERATOR', 'RESIDENT'],
    },
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
      allowedRoles: ['TENANT_OWNER', 'TENANT_ADMIN'],
      deniedRoles: ['OPERATOR', 'RESIDENT'],
    },
    {
      label: 'buildings.write endpoint',
      method: 'post',
      path: '/tenants/tenant-a/buildings',
      body: {
        name: 'North Tower',
      },
      service: buildingsService.create,
      allowedRoles: ['TENANT_OWNER', 'TENANT_ADMIN'],
      deniedRoles: ['OPERATOR', 'RESIDENT'],
    },
  ];

  it.each(protectedRoutes)(
    'allows tenant owners and tenant admins through the real guard chain for $label',
    async ({ method, path, body, service, allowedRoles }) => {
      for (const role of allowedRoles) {
        rolesForRequest = [role];

        const req = request(httpServer)[method](path);
        if (body) {
          req.send(body);
        }
        await req.expect(method === 'post' ? 201 : 200);
      }

      expect(service).toHaveBeenCalledTimes(allowedRoles.length);
    },
  );

  it.each(protectedRoutes)(
    'denies operators and residents with 403 through the real guard chain for $label',
    async ({ method, path, body, service, deniedRoles }) => {
      for (const role of deniedRoles) {
        rolesForRequest = [role];

        const req = request(httpServer)[method](path);
        if (body) {
          req.send(body);
        }
        await req.expect(403);
      }

      expect(service).not.toHaveBeenCalled();
    },
  );

  it.each(protectedRoutes)(
    'denies tenant mismatch before the controller handles $label',
    async ({ method, path, body, service }) => {
      rolesForRequest = ['TENANT_OWNER'];
      hydratedTenantId = 'tenant-b';

      const req = request(httpServer)[method](path);
      if (body) {
        req.send(body);
      }
      await req.expect(403);

      expect(service).not.toHaveBeenCalled();
    },
  );

  it('denies missing or unknown roles for member directories', async () => {
    rolesForRequest = [];
    forceUnknownRole = false;
    hydratedTenantId = 'tenant-a';

    await request(httpServer).get('/tenants/tenant-a/members').expect(403);

    forceUnknownRole = true;
    await request(httpServer).get('/tenants/tenant-a/memberships/invitations').expect(403);
    expect(tenantMembersService.listMembers).not.toHaveBeenCalled();
    expect(invitationsService.listInvitations).not.toHaveBeenCalled();
  });
});
