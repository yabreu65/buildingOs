import type { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/types/request.types';
import { UnitGroupController } from './unit-group.controller';
import { UnitGroupService } from './unit-group.service';

type TestUser = NonNullable<AuthenticatedRequest['user']> & {
  isImpersonating?: boolean;
  impersonatedTenantId?: string;
  actorSuperAdminUserId?: string;
};

describe('UnitGroupController tenant context validation', () => {
  let app: INestApplication;

  const unitGroupService = {
    createUnitGroup: jest.fn() as jest.MockedFunction<
      UnitGroupService['createUnitGroup']
    >,
    getUnitGroup: jest.fn() as jest.MockedFunction<
      UnitGroupService['getUnitGroup']
    >,
    listUnitGroups: jest.fn() as jest.MockedFunction<
      UnitGroupService['listUnitGroups']
    >,
    addMember: jest.fn() as jest.MockedFunction<UnitGroupService['addMember']>,
    removeMember: jest.fn() as jest.MockedFunction<
      UnitGroupService['removeMember']
    >,
    deleteUnitGroup: jest.fn() as jest.MockedFunction<
      UnitGroupService['deleteUnitGroup']
    >,
  };

  const createUser = (overrides: Partial<TestUser> = {}): TestUser => ({
    id: 'user-1',
    email: 'admin@example.com',
    name: 'Admin',
    roles: ['TENANT_ADMIN'],
    membershipId: 'membership-a',
    memberships: [
      {
        id: 'membership-a',
        tenantId: 'tenant-a',
        roles: ['TENANT_ADMIN'],
      },
    ],
    ...overrides,
  });

  let currentUser: TestUser;

  const jwtGuard: CanActivate = {
    canActivate: (context: ExecutionContext): boolean => {
      const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
      req.user = currentUser;
      return true;
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UnitGroupController],
      providers: [{ provide: UnitGroupService, useValue: unitGroupService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(jwtGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    currentUser = createUser();

    unitGroupService.createUnitGroup.mockResolvedValue({
      id: 'group-1',
      tenantId: 'tenant-a',
      buildingId: 'building-1',
      name: 'Grupo A',
      description: null,
      memberCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    unitGroupService.listUnitGroups.mockResolvedValue([
      {
        id: 'group-1',
        tenantId: 'tenant-a',
        buildingId: 'building-1',
        name: 'Grupo A',
        description: null,
        memberCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('accepts matching tenant context for read operations without a tenant header', async () => {
    await request(app.getHttpServer())
      .get('/tenants/tenant-a/unit-groups')
      .expect(200);

    expect(unitGroupService.listUnitGroups).toHaveBeenCalledWith(
      'tenant-a',
      undefined,
      ['TENANT_ADMIN'],
    );
  });

  it('accepts the matching tenant context for write operations and selects the matching membership', async () => {
    currentUser = createUser({
      memberships: [
        {
          id: 'membership-b',
          tenantId: 'tenant-b',
          roles: ['TENANT_ADMIN'],
        },
        {
          id: 'membership-a',
          tenantId: 'tenant-a',
          roles: ['TENANT_ADMIN'],
        },
      ],
    });

    await request(app.getHttpServer())
      .post('/tenants/tenant-a/unit-groups')
      .set('X-Tenant-Id', 'tenant-a')
      .send({
        buildingId: 'building-1',
        name: 'Grupo A',
        unitIds: ['unit-1'],
      })
      .expect(201);

    expect(unitGroupService.createUnitGroup).toHaveBeenCalledWith(
      'tenant-a',
      'building-1',
      'Grupo A',
      undefined,
      ['unit-1'],
      'membership-a',
      ['TENANT_ADMIN'],
    );
  });

  it('rejects contradictory tenant headers before reaching the service', async () => {
    await request(app.getHttpServer())
      .get('/tenants/tenant-a/unit-groups')
      .set('X-Tenant-Id', 'tenant-a')
      .set('Tenant-Id', 'tenant-b')
      .expect(403);

    expect(unitGroupService.listUnitGroups).not.toHaveBeenCalled();
  });

  it('rejects a mismatched tenant header even when the route tenant is authorized', async () => {
    await request(app.getHttpServer())
      .get('/tenants/tenant-a/unit-groups')
      .set('X-Tenant-Id', 'tenant-b')
      .expect(403);

    expect(unitGroupService.listUnitGroups).not.toHaveBeenCalled();
  });

  it('rejects a mismatched route tenant before reaching the service', async () => {
    await request(app.getHttpServer())
      .get('/tenants/tenant-b/unit-groups')
      .set('X-Tenant-Id', 'tenant-b')
      .expect(403);

    expect(unitGroupService.listUnitGroups).not.toHaveBeenCalled();
  });

  it('rejects an unauthorized route tenant even when the header matches the URL', async () => {
    await request(app.getHttpServer())
      .post('/tenants/tenant-b/unit-groups')
      .set('X-Tenant-Id', 'tenant-b')
      .send({
        buildingId: 'building-1',
        name: 'Grupo B',
        unitIds: ['unit-1'],
      })
      .expect(403);

    expect(unitGroupService.createUnitGroup).not.toHaveBeenCalled();
  });

  it('accepts impersonated read access without a membership id', async () => {
    currentUser = createUser({
      membershipId: '',
      isImpersonating: true,
      impersonatedTenantId: 'tenant-a',
      actorSuperAdminUserId: 'super-admin-1',
      roles: ['TENANT_ADMIN'],
      memberships: [
        {
          tenantId: 'tenant-a',
          roles: ['TENANT_ADMIN'],
        },
      ],
    });

    await request(app.getHttpServer())
      .get('/tenants/tenant-a/unit-groups')
      .set('X-Tenant-Id', 'tenant-a')
      .expect(200);

    expect(unitGroupService.listUnitGroups).toHaveBeenCalledWith(
      'tenant-a',
      undefined,
      ['TENANT_ADMIN'],
    );
  });

  it('rejects impersonated writes explicitly', async () => {
    currentUser = createUser({
      membershipId: '',
      isImpersonating: true,
      impersonatedTenantId: 'tenant-a',
      actorSuperAdminUserId: 'super-admin-1',
      roles: ['TENANT_ADMIN'],
      memberships: [
        {
          tenantId: 'tenant-a',
          roles: ['TENANT_ADMIN'],
        },
      ],
    });

    await request(app.getHttpServer())
      .post('/tenants/tenant-a/unit-groups')
      .set('X-Tenant-Id', 'tenant-a')
      .send({
        buildingId: 'building-1',
        name: 'Grupo A',
        unitIds: ['unit-1'],
      })
      .expect(403);

    expect(unitGroupService.createUnitGroup).not.toHaveBeenCalled();
  });
});
