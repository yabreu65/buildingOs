import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

describe('SuperAdmin Module E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let superAdminToken: string;
  let tenantAdminToken: string;
  let createdTenantId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    jwtService = moduleFixture.get<JwtService>(JwtService);

    // Get SUPER_ADMIN user and generate token
    const superAdmin = await prisma.user.findUnique({
      where: { email: 'superadmin@demo.com' },
      include: {
        memberships: {
          include: { roles: true },
        },
      },
    });

    superAdminToken = jwtService.sign({
      email: superAdmin.email,
      sub: superAdmin.id,
      isSuperAdmin: true,
    });

    // Get TENANT_ADMIN user and generate token
    const tenantAdmin = await prisma.user.findUnique({
      where: { email: 'admin@demo.com' },
      include: {
        memberships: {
          include: { roles: true },
        },
      },
    });

    tenantAdminToken = jwtService.sign({
      email: tenantAdmin.email,
      sub: tenantAdmin.id,
      isSuperAdmin: false,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/super-admin/tenants (Create)', () => {
    it('should create tenant with SUPER_ADMIN token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/super-admin/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'New Test Tenant',
          type: 'ADMINISTRADORA',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('New Test Tenant');
      expect(response.body.type).toBe('ADMINISTRADORA');
      createdTenantId = response.body.id;

      // Verify audit log was created
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          entityId: createdTenantId,
          action: 'TENANT_CREATE',
        },
      });
      expect(auditLog).toBeDefined();
      expect(auditLog.tenantId).toBe(createdTenantId);
    });

    it('should reject without token (401)', async () => {
      await request(app.getHttpServer())
        .post('/api/super-admin/tenants')
        .send({
          name: 'No Token Tenant',
          type: 'ADMINISTRADORA',
        })
        .expect(401);
    });

    it('should reject with non-SUPER_ADMIN token (403)', async () => {
      await request(app.getHttpServer())
        .post('/api/super-admin/tenants')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({
          name: 'Forbidden Tenant',
          type: 'ADMINISTRADORA',
        })
        .expect(403);
    });

    it('should reject duplicate name (409)', async () => {
      // First create
      await request(app.getHttpServer())
        .post('/api/super-admin/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'Duplicate Name Tenant',
          type: 'ADMINISTRADORA',
        })
        .expect(201);

      // Second create with same name
      await request(app.getHttpServer())
        .post('/api/super-admin/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'Duplicate Name Tenant',
          type: 'EDIFICIO_AUTOGESTION',
        })
        .expect(409);
    });

    it('should reject invalid DTO', async () => {
      await request(app.getHttpServer())
        .post('/api/super-admin/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'X', // Too short
          type: 'INVALID_TYPE',
        })
        .expect(400);
    });
  });

  describe('GET /api/super-admin/tenants (List)', () => {
    it('should list tenants with SUPER_ADMIN token', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/super-admin/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('total');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.total).toBeGreaterThan(0);
    });

    it('should respect pagination', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/super-admin/tenants?skip=0&take=1')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(response.body.data.length).toBeLessThanOrEqual(1);
    });

    it('should reject without token (401)', async () => {
      await request(app.getHttpServer())
        .get('/api/super-admin/tenants')
        .expect(401);
    });

    it('should reject with non-SUPER_ADMIN token (403)', async () => {
      await request(app.getHttpServer())
        .get('/api/super-admin/tenants')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .expect(403);
    });
  });

  describe('GET /api/super-admin/tenants/:tenantId (Get)', () => {
    it('should get single tenant', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/super-admin/tenants/${createdTenantId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(response.body.id).toBe(createdTenantId);
    });

    it('should return 404 for non-existent tenant', async () => {
      await request(app.getHttpServer())
        .get('/api/super-admin/tenants/nonexistent-id-12345')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(404);
    });
  });

  describe('PATCH /api/super-admin/tenants/:tenantId (Update)', () => {
    it('should update tenant name', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/super-admin/tenants/${createdTenantId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'Updated Test Tenant',
        })
        .expect(200);

      expect(response.body.name).toBe('Updated Test Tenant');

      // Verify audit log was created
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          entityId: createdTenantId,
          action: 'TENANT_UPDATE',
        },
      });
      expect(auditLog).toBeDefined();
      expect(auditLog.metadata).toHaveProperty('before');
      expect(auditLog.metadata).toHaveProperty('after');
    });

    it('should reject update without token (401)', async () => {
      await request(app.getHttpServer())
        .patch(`/api/super-admin/tenants/${createdTenantId}`)
        .send({
          name: 'No Token Update',
        })
        .expect(401);
    });

    it('should reject update with non-SUPER_ADMIN token (403)', async () => {
      await request(app.getHttpServer())
        .patch(`/api/super-admin/tenants/${createdTenantId}`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({
          name: 'Forbidden Update',
        })
        .expect(403);
    });
  });

  describe('DELETE /api/super-admin/tenants/:tenantId (Delete)', () => {
    it('should delete tenant', async () => {
      // Create a tenant to delete
      const createRes = await request(app.getHttpServer())
        .post('/api/super-admin/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'Tenant To Delete',
          type: 'ADMINISTRADORA',
        })
        .expect(201);

      const tenantToDeleteId = createRes.body.id;

      // Delete it
      await request(app.getHttpServer())
        .delete(`/api/super-admin/tenants/${tenantToDeleteId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(204);

      // Verify it's deleted
      await request(app.getHttpServer())
        .get(`/api/super-admin/tenants/${tenantToDeleteId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(404);

      // Verify audit log was created
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          entityId: tenantToDeleteId,
          action: 'TENANT_DELETE',
        },
      });
      expect(auditLog).toBeDefined();
    });

    it('should reject delete without token (401)', async () => {
      await request(app.getHttpServer())
        .delete(`/api/super-admin/tenants/${createdTenantId}`)
        .expect(401);
    });

    it('should reject delete with non-SUPER_ADMIN token (403)', async () => {
      await request(app.getHttpServer())
        .delete(`/api/super-admin/tenants/${createdTenantId}`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .expect(403);
    });
  });

  describe('GET /api/super-admin/stats (Stats)', () => {
    it('should return global stats', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/super-admin/stats')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('totalTenants');
      expect(response.body).toHaveProperty('totalUsers');
      expect(response.body).toHaveProperty('tenantsByType');
      expect(response.body).toHaveProperty('recentTenants');
      expect(response.body.totalTenants).toBeGreaterThan(0);
      expect(response.body.totalUsers).toBeGreaterThan(0);
    });

    it('should reject without token (401)', async () => {
      await request(app.getHttpServer())
        .get('/api/super-admin/stats')
        .expect(401);
    });

    it('should reject with non-SUPER_ADMIN token (403)', async () => {
      await request(app.getHttpServer())
        .get('/api/super-admin/stats')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .expect(403);
    });
  });

  describe('GET /api/super-admin/audit-logs (Audit Trail)', () => {
    it('should return audit logs', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/super-admin/audit-logs')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('total');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should filter by tenantId', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/super-admin/audit-logs?tenantId=${createdTenantId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      if (response.body.data.length > 0) {
        response.body.data.forEach((log) => {
          expect(log.tenantId).toBe(createdTenantId);
        });
      }
    });

    it('should filter by action', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/super-admin/audit-logs?action=TENANT_CREATE')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      if (response.body.data.length > 0) {
        response.body.data.forEach((log) => {
          expect(log.action).toBe('TENANT_CREATE');
        });
      }
    });

    it('should reject without token (401)', async () => {
      await request(app.getHttpServer())
        .get('/api/super-admin/audit-logs')
        .expect(401);
    });

    it('should reject with non-SUPER_ADMIN token (403)', async () => {
      await request(app.getHttpServer())
        .get('/api/super-admin/audit-logs')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .expect(403);
    });
  });

  describe('Authorization & Multi-Tenancy Security', () => {
    it('should never leak tenant data across boundaries', async () => {
      // Create two separate tenants
      const tenant1Res = await request(app.getHttpServer())
        .post('/api/super-admin/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'Tenant 1 Isolation Test',
          type: 'ADMINISTRADORA',
        })
        .expect(201);

      const tenant2Res = await request(app.getHttpServer())
        .post('/api/super-admin/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'Tenant 2 Isolation Test',
          type: 'EDIFICIO_AUTOGESTION',
        })
        .expect(201);

      // Verify both exist and have different IDs
      expect(tenant1Res.body.id).not.toBe(tenant2Res.body.id);

      // List should show both
      const listRes = await request(app.getHttpServer())
        .get('/api/super-admin/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      const ids = listRes.body.data.map((t) => t.id);
      expect(ids).toContain(tenant1Res.body.id);
      expect(ids).toContain(tenant2Res.body.id);
    });
  });
});
