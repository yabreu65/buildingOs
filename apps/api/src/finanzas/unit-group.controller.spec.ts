import type { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UnitGroupController } from './unit-group.controller';
import { UnitGroupService } from './unit-group.service';

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

  const jwtGuard: CanActivate = {
    canActivate: (context: ExecutionContext): boolean => {
      const req = context.switchToHttp().getRequest();
      req.user = {
        id: 'user-1',
        email: 'admin@example.com',
        name: 'Admin',
        memberships: [
          {
            id: 'membership-a',
            tenantId: 'tenant-a',
            roles: ['TENANT_ADMIN'],
          },
        ],
      };
      return true;
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UnitGroupController],
      providers: [
        { provide: UnitGroupService, useValue: unitGroupService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(jwtGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
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

  it('accepts the matching tenant context for read operations', async () => {
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

  it('accepts the matching tenant context for write operations', async () => {
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

  it('rejects a mismatched route tenant before reaching the service', async () => {
    await request(app.getHttpServer())
      .get('/tenants/tenant-b/unit-groups')
      .set('X-Tenant-Id', 'tenant-a')
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
});
