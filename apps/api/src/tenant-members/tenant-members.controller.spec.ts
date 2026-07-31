import type { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { TenantMembersController } from './tenant-members.controller';
import { TenantMembersService } from './tenant-members.service';
import { TenantPermissionGuard } from '../rbac/tenant-permission.guard';

jest.mock('@buildingos/contracts', () => ({
  Role: {
    SUPER_ADMIN: 'SUPER_ADMIN',
    TENANT_OWNER: 'TENANT_OWNER',
    TENANT_ADMIN: 'TENANT_ADMIN',
    OPERATOR: 'OPERATOR',
    RESIDENT: 'RESIDENT',
  },
}));

jest.mock('./tenant-members.service', () => ({
  TenantMembersService: class TenantMembersService {},
}));

describe('TenantMembersController validation', () => {
  let app: INestApplication;
  let httpServer: Server;

  const tenantMembersService = {
    getAssignableResidents: jest.fn(),
  } satisfies Pick<TenantMembersService, 'getAssignableResidents'>;

  const jwtGuard: CanActivate = {
    canActivate: (context: ExecutionContext): boolean => {
      const req = context.switchToHttp().getRequest();
      req.user = {
        id: 'user-1',
        email: 'admin@example.com',
        name: 'Admin',
        roles: ['TENANT_OWNER'],
        memberships: [
          {
            id: 'membership-1',
            tenantId: 'tenant-a',
            roles: ['TENANT_OWNER'],
          },
        ],
      };
      return true;
    },
  };

  const tenantAccessGuard: CanActivate = {
    canActivate: (context: ExecutionContext): boolean => {
      const req = context.switchToHttp().getRequest();
      req.tenantId = req.params.tenantId;
      return true;
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TenantMembersController],
      providers: [
        TenantPermissionGuard,
        { provide: TenantMembersService, useValue: tenantMembersService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(jwtGuard)
      .overrideGuard(TenantAccessGuard)
      .useValue(tenantAccessGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  beforeEach(() => {
    tenantMembersService.getAssignableResidents.mockResolvedValue([
      {
        id: 'member-1',
        name: 'Resident One',
        email: 'resident@example.com',
        phone: '+15550000001',
        role: 'RESIDENT',
        status: 'ACTIVE',
        assignedUnits: 0,
        isPrimaryIn: [],
      },
    ]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('trims a valid unitId before calling the service', async () => {
    await request(httpServer)
      .get('/tenants/tenant-a/members/assignable?unitId=%20unit-1%20')
      .expect(200);

    expect(tenantMembersService.getAssignableResidents).toHaveBeenCalledWith(
      'tenant-a',
      'unit-1',
    );
  });

  it('allows the assignable list without unitId', async () => {
    await request(httpServer)
      .get('/tenants/tenant-a/members/assignable')
      .expect(200);

    expect(tenantMembersService.getAssignableResidents).toHaveBeenCalledWith(
      'tenant-a',
      undefined,
    );
  });

  it('rejects malformed member ids before reaching the service', async () => {
    await request(httpServer)
      .get('/tenants/tenant-a/members/member%201')
      .expect(400);

    expect(tenantMembersService.getAssignableResidents).not.toHaveBeenCalled();
  });

  it.each([
    ['blank unitId', '/tenants/tenant-a/members/assignable?unitId=%20%20'],
    ['unknown query', '/tenants/tenant-a/members/assignable?unitIid=unit-1'],
  ])('rejects %s with 400 and does not call the service', async (_label, path) => {
    await request(httpServer).get(path).expect(400);

    expect(tenantMembersService.getAssignableResidents).not.toHaveBeenCalled();
  });
});
