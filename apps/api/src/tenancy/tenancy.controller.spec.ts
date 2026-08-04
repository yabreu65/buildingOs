import { ForbiddenException, UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditService } from '../audit/audit.service';
import { TenantAccessGuard } from './tenant-access.guard';
import { TenancyController } from './tenancy.controller';
import { TenancyStatsService } from './tenancy-stats.service';
import { BrandingService } from './branding.service';
import { PrismaService } from '../prisma/prisma.service';

interface ScenarioMembership {
  tenantId: string;
  roles: string[];
}

interface ScenarioUser {
  id: string;
  email: string;
  name?: string;
  memberships: ScenarioMembership[];
  isImpersonating?: boolean;
  impersonatedTenantId?: string;
}

describe('TenancyController branding endpoint', () => {
  let httpServer: ReturnType<INestApplication['getHttpServer']>;
  let app: INestApplication;
  const tenantId = 'tenant-1';
  const dto = { currency: 'USD' };

  const prisma = {
    tenant: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    file: {
      findFirst: jest.fn(),
    },
  } satisfies Pick<PrismaService, 'tenant' | 'file'>;

  const audit = {
    createLog: jest.fn(),
  } satisfies Pick<AuditService, 'createLog'>;

  const tenancyStatsService = {
    getTenantStats: jest.fn(),
    getTenantBilling: jest.fn(),
    getTenantAuditLogs: jest.fn(),
  } satisfies Pick<
    TenancyStatsService,
    'getTenantStats' | 'getTenantBilling' | 'getTenantAuditLogs'
  >;

  let scenario: { user?: ScenarioUser; throwUnauthorized?: boolean } = {
    user: undefined,
    throwUnauthorized: false,
  };

  const jwtGuard = {
    canActivate: jest.fn((context) => {
      if (scenario.throwUnauthorized) {
        throw new UnauthorizedException('Unauthorized');
      }

      const req = context.switchToHttp().getRequest();
      req.user = scenario.user;
      return true;
    }),
  };

  const tenantAccessGuard = {
    canActivate: jest.fn((context) => {
      const req = context.switchToHttp().getRequest();
      const routeTenantId = req.params.tenantId;

      if (!req.user || !routeTenantId) {
        throw new ForbiddenException('No tiene acceso al tenant');
      }

      if (req.user.isImpersonating && req.user.impersonatedTenantId !== routeTenantId) {
        throw new ForbiddenException('No tiene acceso al tenant');
      }

      const membership = req.user.memberships?.find((entry) => entry.tenantId === routeTenantId);
      if (!membership) {
        throw new ForbiddenException('No tiene acceso al tenant');
      }

      req.tenantId = routeTenantId;
      req.user.roles = membership.roles;
      req.user.role = membership.roles[0];
      return true;
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TenancyController],
      providers: [
        BrandingService,
        { provide: TenancyStatsService, useValue: tenancyStatsService },
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(jwtGuard)
      .overrideGuard(TenantAccessGuard)
      .useValue(tenantAccessGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    scenario = { user: undefined, throwUnauthorized: false };
    prisma.tenant.findUnique.mockResolvedValue({
      id: tenantId,
      name: 'Tenant 1',
      brandName: 'Tenant One',
      logoFileId: null,
      primaryColor: null,
      secondaryColor: null,
      theme: null,
      emailFooter: null,
      currency: 'ARS',
      locale: 'es-AR',
    });
    prisma.tenant.update.mockResolvedValue({
      id: tenantId,
      name: 'Tenant 1',
      brandName: 'Tenant One',
      logoFileId: null,
      primaryColor: null,
      secondaryColor: null,
      theme: null,
      emailFooter: null,
      currency: 'USD',
      locale: 'es-AR',
    });
    prisma.file.findFirst.mockResolvedValue(null);
    audit.createLog.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns 401 when the request is not authenticated', async () => {
    scenario.throwUnauthorized = true;

    await request(httpServer)
      .patch(`/tenants/${tenantId}/branding`)
      .send(dto)
      .expect(401);

    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it('returns 403 when the user only belongs to a different tenant', async () => {
    scenario.user = {
      id: 'user-1',
      email: 'tenant-b@test.com',
      memberships: [
        {
          tenantId: 'tenant-2',
          roles: ['TENANT_ADMIN'],
        },
      ],
    };

    await request(httpServer)
      .patch(`/tenants/${tenantId}/branding`)
      .send(dto)
      .expect(403);

    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it('returns 403 for residents in the same tenant', async () => {
    scenario.user = {
      id: 'user-1',
      email: 'resident@test.com',
      memberships: [
        {
          tenantId,
          roles: ['RESIDENT'],
        },
      ],
    };

    await request(httpServer)
      .patch(`/tenants/${tenantId}/branding`)
      .send(dto)
      .expect(403);

    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it.each([
    ['OPERATOR'],
    ['SUPER_ADMIN'],
  ])('returns 403 for unauthorized administrative role %s', async (role) => {
    scenario.user = {
      id: 'user-1',
      email: 'admin@test.com',
      memberships: [
        {
          tenantId,
          roles: [role],
        },
      ],
    };

    await request(httpServer)
      .patch(`/tenants/${tenantId}/branding`)
      .send(dto)
      .expect(403);

    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it.each([
    ['TENANT_OWNER'],
    ['TENANT_ADMIN'],
  ])('allows authorized tenant role %s', async (role) => {
    scenario.user = {
      id: 'user-1',
      email: 'admin@test.com',
      memberships: [
        {
          tenantId,
          roles: [role],
        },
      ],
    };

    await request(httpServer)
      .patch(`/tenants/${tenantId}/branding`)
      .send(dto)
      .expect(200);

    expect(prisma.tenant.update).toHaveBeenCalledWith({
      where: { id: tenantId },
      data: expect.objectContaining({
        currency: 'USD',
      }),
    });
    expect(audit.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        actorUserId: 'user-1',
        action: 'TENANT_BRANDING_UPDATED',
      }),
    );
  });

  it('preserves impersonation when the impersonated tenant role is administrative', async () => {
    scenario.user = {
      id: 'user-1',
      email: 'superadmin@test.com',
      isImpersonating: true,
      impersonatedTenantId: tenantId,
      memberships: [
        {
          tenantId,
          roles: ['TENANT_ADMIN'],
        },
      ],
    };

    await request(httpServer)
      .patch(`/tenants/${tenantId}/branding`)
      .send(dto)
      .expect(200);

    expect(prisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: tenantId },
      }),
    );
  });

  it('rejects impersonation when the impersonated tenant role is resident', async () => {
    scenario.user = {
      id: 'user-1',
      email: 'superadmin@test.com',
      isImpersonating: true,
      impersonatedTenantId: tenantId,
      memberships: [
        {
          tenantId,
          roles: ['RESIDENT'],
        },
      ],
    };

    await request(httpServer)
      .patch(`/tenants/${tenantId}/branding`)
      .send(dto)
      .expect(403);

    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it('passes the route tenantId through to the service when authorized', async () => {
    scenario.user = {
      id: 'user-1',
      email: 'admin@test.com',
      memberships: [
        {
          tenantId,
          roles: ['TENANT_ADMIN'],
        },
      ],
    };

    await request(httpServer)
      .patch(`/tenants/${tenantId}/branding`)
      .send(dto)
      .expect(200);

    expect(prisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: tenantId },
      }),
    );
  });
});
