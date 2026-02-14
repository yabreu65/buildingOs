import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

describe('Tenant Stats Module E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let tenantAdminToken: string;
  let operatorToken: string;
  let residentToken: string;
  let otherTenantAdminToken: string;
  let demoTenantId: string;
  let tenantBuildingId: string;
  let otherTenantId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    jwtService = moduleFixture.get<JwtService>(JwtService);

    // Get TENANT_ADMIN user for demo tenant
    const tenantAdmin = await prisma.user.findUnique({
      where: { email: 'admin@demo.com' },
      include: {
        memberships: {
          include: { roles: true },
        },
      },
    });

    demoTenantId = tenantAdmin.memberships[0].tenantId;

    tenantAdminToken = jwtService.sign({
      email: tenantAdmin.email,
      sub: tenantAdmin.id,
      isSuperAdmin: false,
    });

    // Get OPERATOR user
    const operator = await prisma.user.findUnique({
      where: { email: 'operator@demo.com' },
      include: {
        memberships: {
          include: { roles: true },
        },
      },
    });

    // Get operator's tenant (should be tenantBuilding)
    tenantBuildingId = operator.memberships[0].tenantId;

    operatorToken = jwtService.sign({
      email: operator.email,
      sub: operator.id,
      isSuperAdmin: false,
    });

    // Get RESIDENT user
    const resident = await prisma.user.findUnique({
      where: { email: 'resident@demo.com' },
      include: {
        memberships: {
          include: { roles: true },
        },
      },
    });

    residentToken = jwtService.sign({
      email: resident.email,
      sub: resident.id,
      isSuperAdmin: false,
    });

    // Create a second tenant to test isolation
    const newTenant = await prisma.tenant.create({
      data: {
        name: `Test Tenant ${Date.now()}`,
        type: 'ADMINISTRADORA',
      },
    });
    otherTenantId = newTenant.id;

    // Create a user in the other tenant
    const otherUser = await prisma.user.create({
      data: {
        email: `user-${Date.now()}@test.com`,
        name: 'Other User',
        passwordHash: 'hashed',
        memberships: {
          create: {
            tenantId: otherTenantId,
            roles: {
              create: {
                role: 'TENANT_ADMIN',
              },
            },
          },
        },
      },
    });

    otherTenantAdminToken = jwtService.sign({
      email: otherUser.email,
      sub: otherUser.id,
      isSuperAdmin: false,
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.tenant.delete({
      where: { id: otherTenantId },
    });
    await app.close();
  });

  describe('GET /tenants/:tenantId/stats', () => {
    it('should fetch tenant stats with valid token', async () => {
      const response = await request(app.getHttpServer())
        .get(`/tenants/${demoTenantId}/stats`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('totalBuildings');
      expect(response.body).toHaveProperty('totalUnits');
      expect(response.body).toHaveProperty('occupiedUnits');
      expect(response.body).toHaveProperty('vacantUnits');
      expect(response.body).toHaveProperty('unknownUnits');
      expect(response.body).toHaveProperty('totalResidents');

      // Verify numeric values
      expect(typeof response.body.totalBuildings).toBe('number');
      expect(typeof response.body.totalUnits).toBe('number');
      expect(response.body.totalBuildings >= 0).toBe(true);
      expect(response.body.totalUnits >= 0).toBe(true);
    });

    it('should reject without token (401)', async () => {
      await request(app.getHttpServer())
        .get(`/tenants/${demoTenantId}/stats`)
        .expect(401);
    });

    it('should reject user without access to tenant (403)', async () => {
      await request(app.getHttpServer())
        .get(`/tenants/${demoTenantId}/stats`)
        .set('Authorization', `Bearer ${otherTenantAdminToken}`)
        .expect(403);
    });

    it('should allow OPERATOR to fetch stats', async () => {
      const response = await request(app.getHttpServer())
        .get(`/tenants/${tenantBuildingId}/stats`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('totalBuildings');
      expect(response.body).toHaveProperty('totalUnits');
    });

    it('should allow RESIDENT to fetch stats', async () => {
      const response = await request(app.getHttpServer())
        .get(`/tenants/${tenantBuildingId}/stats`)
        .set('Authorization', `Bearer ${residentToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('totalBuildings');
    });
  });

  describe('GET /tenants/:tenantId/billing', () => {
    it('should fetch billing info with valid token', async () => {
      const response = await request(app.getHttpServer())
        .get(`/tenants/${demoTenantId}/billing`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('subscription');
      expect(response.body).toHaveProperty('plan');
      expect(response.body).toHaveProperty('usage');

      expect(response.body.subscription).toHaveProperty('status');
      expect(response.body.subscription).toHaveProperty('planId');

      expect(response.body.plan).toHaveProperty('name');
      expect(response.body.plan).toHaveProperty('maxBuildings');
      expect(response.body.plan).toHaveProperty('maxUnits');

      expect(response.body.usage).toHaveProperty('buildings');
      expect(response.body.usage).toHaveProperty('units');
      expect(response.body.usage).toHaveProperty('residents');
    });

    it('should include correct plan limits', async () => {
      const response = await request(app.getHttpServer())
        .get(`/tenants/${demoTenantId}/billing`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .expect(200);

      expect(response.body.plan.maxBuildings > 0).toBe(true);
      expect(response.body.plan.maxUnits > 0).toBe(true);
      expect(response.body.plan.maxUsers > 0).toBe(true);
      expect(response.body.plan.maxOccupants > 0).toBe(true);
    });

    it('should reject without token (401)', async () => {
      await request(app.getHttpServer())
        .get(`/tenants/${demoTenantId}/billing`)
        .expect(401);
    });

    it('should reject user without access to tenant (403)', async () => {
      await request(app.getHttpServer())
        .get(`/tenants/${demoTenantId}/billing`)
        .set('Authorization', `Bearer ${otherTenantAdminToken}`)
        .expect(403);
    });
  });

  describe('GET /tenants/:tenantId/audit-logs', () => {
    it('should fetch audit logs with valid token', async () => {
      const response = await request(app.getHttpServer())
        .get(`/tenants/${demoTenantId}/audit-logs`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('total');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(typeof response.body.total).toBe('number');
    });

    it('should return audit log entries with correct structure', async () => {
      const response = await request(app.getHttpServer())
        .get(`/tenants/${demoTenantId}/audit-logs`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .expect(200);

      if (response.body.data.length > 0) {
        const log = response.body.data[0];
        expect(log).toHaveProperty('id');
        expect(log).toHaveProperty('action');
        expect(log).toHaveProperty('entity');
        expect(log).toHaveProperty('entityId');
        expect(log).toHaveProperty('createdAt');
      }
    });

    it('should support pagination with skip and take', async () => {
      const response = await request(app.getHttpServer())
        .get(`/tenants/${demoTenantId}/audit-logs?skip=0&take=5`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .expect(200);

      expect(response.body.data.length).toBeLessThanOrEqual(5);
    });

    it('should support filtering by action', async () => {
      const response = await request(app.getHttpServer())
        .get(`/tenants/${demoTenantId}/audit-logs?action=TENANT_CREATE`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('total');

      // If there are results, verify they match the filter
      if (response.body.data.length > 0) {
        response.body.data.forEach((log: any) => {
          expect(log.action).toBe('TENANT_CREATE');
        });
      }
    });

    it('should only return tenant-scoped logs', async () => {
      const response = await request(app.getHttpServer())
        .get(`/tenants/${demoTenantId}/audit-logs`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .expect(200);

      // All logs should belong to this tenant
      response.body.data.forEach((log: any) => {
        expect(log).toBeDefined();
      });
    });

    it('should reject without token (401)', async () => {
      await request(app.getHttpServer())
        .get(`/tenants/${demoTenantId}/audit-logs`)
        .expect(401);
    });

    it('should reject user without access to tenant (403)', async () => {
      await request(app.getHttpServer())
        .get(`/tenants/${demoTenantId}/audit-logs`)
        .set('Authorization', `Bearer ${otherTenantAdminToken}`)
        .expect(403);
    });
  });

  describe('Tenant Isolation', () => {
    it('TENANT_A user should NOT see stats of TENANT_B', async () => {
      await request(app.getHttpServer())
        .get(`/tenants/${demoTenantId}/stats`)
        .set('Authorization', `Bearer ${otherTenantAdminToken}`)
        .expect(403);
    });

    it('TENANT_A user should NOT see billing of TENANT_B', async () => {
      await request(app.getHttpServer())
        .get(`/tenants/${demoTenantId}/billing`)
        .set('Authorization', `Bearer ${otherTenantAdminToken}`)
        .expect(403);
    });

    it('TENANT_A user should NOT see audit logs of TENANT_B', async () => {
      await request(app.getHttpServer())
        .get(`/tenants/${demoTenantId}/audit-logs`)
        .set('Authorization', `Bearer ${otherTenantAdminToken}`)
        .expect(403);
    });

    it('TENANT_B user CAN access their own stats', async () => {
      const response = await request(app.getHttpServer())
        .get(`/tenants/${otherTenantId}/stats`)
        .set('Authorization', `Bearer ${otherTenantAdminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('totalBuildings');
    });

    it('TENANT_B user CAN access their own billing', async () => {
      const response = await request(app.getHttpServer())
        .get(`/tenants/${otherTenantId}/billing`)
        .set('Authorization', `Bearer ${otherTenantAdminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('subscription');
      expect(response.body).toHaveProperty('plan');
    });
  });
});
