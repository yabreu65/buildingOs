import { ForbiddenException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AssistantController } from './assistant.controller';
import { AiBudgetController } from './ai-budget.controller';
import { AiNudgesController } from './ai-nudges.controller';
import { AiAnalyticsService } from './analytics.service';
import { AiBudgetService } from './budget.service';
import { AiNudgesService } from './ai-nudges.service';
import { AiRouterService } from './router.service';
import { AiCacheService } from './cache.service';
import { AssistantService } from './assistant.service';
import { AiActionEventsService } from './action-events.service';
import { AiEntitlementsService } from '../billing/ai-entitlements.service';
import { PlanFeaturesService } from '../billing/plan-features.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/types/request.types';

describe('AI settings authorization integration', () => {
  let app: INestApplication;
  let currentUser: AuthenticatedRequest['user'];
  const analyticsService = {
    getTenantAnalytics: jest.fn().mockResolvedValue({ ok: true }),
  } as unknown as AiAnalyticsService;
  const budgetService = {
    getUsageWithLimits: jest.fn().mockResolvedValue({ ok: true }),
    getUsageData: jest.fn().mockResolvedValue({ ok: true }),
  } as unknown as AiBudgetService;
  const nudgesService = {
    resolveTenantId: jest.fn((user, requestedTenantId?: string) => {
      if (!requestedTenantId) {
        throw new ForbiddenException('tenantId requerido para esta prueba');
      }

      const memberships = user.memberships ?? [];
      if (!memberships.some((membership) => membership.tenantId === requestedTenantId)) {
        throw new ForbiddenException('No tienes acceso al tenant indicado');
      }

      return requestedTenantId;
    }),
    getActiveNudges: jest.fn().mockResolvedValue([{ key: 'NUDGE_80' }]),
    dismissNudge: jest.fn().mockResolvedValue({ key: 'NUDGE_80', dismissedUntil: new Date().toISOString() }),
    createRecommendedUpgradeRequest: jest.fn().mockResolvedValue({
      requestId: 'request-1',
      requestedPlanId: 'plan-pro',
      note: 'ok',
      alreadyPending: false,
    }),
  } as unknown as AiNudgesService;
  const assistantService = {} as unknown as AssistantService;
  const actionEventsService = {} as unknown as AiActionEventsService;
  const aiEntitlements = {} as unknown as AiEntitlementsService;
  const routerService = {} as unknown as AiRouterService;
  const cacheService = {} as unknown as AiCacheService;
  const prismaServiceMock = {
    membership: {
      findUnique: jest.fn(),
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AssistantController, AiBudgetController, AiNudgesController],
      providers: [
        { provide: AiAnalyticsService, useValue: analyticsService },
        { provide: AiBudgetService, useValue: budgetService },
        { provide: AiNudgesService, useValue: nudgesService },
        { provide: AssistantService, useValue: assistantService },
        { provide: AiActionEventsService, useValue: actionEventsService },
        { provide: AiEntitlementsService, useValue: aiEntitlements },
        {
          provide: PlanFeaturesService,
          useValue: {
            hasFeature: jest.fn().mockResolvedValue(true),
          },
        },
        { provide: AiRouterService, useValue: routerService },
        { provide: AiCacheService, useValue: cacheService },
        { provide: PrismaService, useValue: prismaServiceMock as unknown as PrismaService },
        TenantAccessGuard,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: { switchToHttp: () => { getRequest: () => AuthenticatedRequest } }) => {
          const request = context.switchToHttp().getRequest();
          request.user = currentUser;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    currentUser = {
      id: 'user-1',
      email: 'user@example.com',
      name: 'User One',
      memberships: [],
    };
    prismaServiceMock.membership.findUnique.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  function mockTenantMembership(tenantId: string, roles: string[]) {
    prismaServiceMock.membership.findUnique.mockResolvedValue({
      id: 'membership-1',
      tenantId,
      roles: roles.map((role, index) => ({
        id: `role-${index}`,
        role,
        scopeType: 'TENANT',
        scopeBuildingId: null,
        scopeUnitId: null,
      })),
    });
  }

  it('denies residents on tenant AI analytics before the service executes', async () => {
    mockTenantMembership('tenant-1', ['RESIDENT']);

    await request(app.getHttpServer())
      .get('/tenants/tenant-1/assistant/analytics')
      .set('X-Tenant-Id', 'tenant-1')
      .expect(403);

    expect(analyticsService.getTenantAnalytics).not.toHaveBeenCalled();
  });

  it('allows tenant admins on usage-with-limits and passes the tenant through', async () => {
    mockTenantMembership('tenant-1', ['TENANT_ADMIN']);

    await request(app.getHttpServer())
      .get('/tenants/tenant-1/assistant/usage-with-limits')
      .set('X-Tenant-Id', 'tenant-1')
      .expect(200);

    expect(budgetService.getUsageWithLimits).toHaveBeenCalledWith('tenant-1', undefined);
  });

  it('denies residents on nudge dismissal before any mutation runs', async () => {
    currentUser = {
      id: 'resident-1',
      email: 'resident@example.com',
      name: 'Resident One',
      memberships: [{ tenantId: 'tenant-1', roles: ['RESIDENT'] }],
    };

    await request(app.getHttpServer())
      .post('/me/ai/nudges/NUDGE_80/dismiss')
      .set('X-Tenant-Id', 'tenant-1')
      .expect(403);

    expect(nudgesService.dismissNudge).not.toHaveBeenCalled();
  });

  it('denies residents on upgrade requests before any mutation runs', async () => {
    currentUser = {
      id: 'resident-1',
      email: 'resident@example.com',
      name: 'Resident One',
      memberships: [{ tenantId: 'tenant-1', roles: ['RESIDENT'] }],
    };

    await request(app.getHttpServer())
      .post('/me/ai/upgrade-request/recommended')
      .set('X-Tenant-Id', 'tenant-1')
      .send({ tenantId: 'tenant-1' })
      .expect(403);

    expect(nudgesService.createRecommendedUpgradeRequest).not.toHaveBeenCalled();
  });

  it('allows impersonating tenant admins when the impersonated tenant matches the requested tenant', async () => {
    currentUser = {
      id: 'impersonator-1',
      email: 'impersonator@example.com',
      name: 'Impersonator One',
      isImpersonating: true,
      impersonatedTenantId: 'tenant-1',
      memberships: [{ tenantId: 'tenant-1', roles: ['TENANT_ADMIN'] }],
      effectiveMembership: { tenantId: 'tenant-1', roles: ['TENANT_ADMIN'] },
    };

    await request(app.getHttpServer())
      .get('/me/ai/nudges')
      .set('X-Tenant-Id', 'tenant-1')
      .expect(200);

    expect(nudgesService.getActiveNudges).toHaveBeenCalledWith(currentUser, 'tenant-1');
  });

  it('denies impersonation when the requested tenant does not match the impersonated tenant', async () => {
    currentUser = {
      id: 'impersonator-1',
      email: 'impersonator@example.com',
      name: 'Impersonator One',
      isImpersonating: true,
      impersonatedTenantId: 'tenant-1',
      memberships: [
        { tenantId: 'tenant-1', roles: ['TENANT_ADMIN'] },
        { tenantId: 'tenant-2', roles: ['TENANT_ADMIN'] },
      ],
      effectiveMembership: { tenantId: 'tenant-1', roles: ['TENANT_ADMIN'] },
    };

    await request(app.getHttpServer())
      .get('/me/ai/nudges')
      .set('X-Tenant-Id', 'tenant-2')
      .expect(403);

    expect(nudgesService.getActiveNudges).not.toHaveBeenCalled();
  });

  it('rejects conflicting tenant sources on upgrade requests before any mutation runs', async () => {
    currentUser = {
      id: 'operator-1',
      email: 'operator@example.com',
      name: 'Operator One',
      memberships: [{ tenantId: 'tenant-1', roles: ['OPERATOR'] }],
    };

    await request(app.getHttpServer())
      .post('/me/ai/upgrade-request/recommended')
      .set('X-Tenant-Id', 'tenant-1')
      .send({ tenantId: 'tenant-2' })
      .expect(400);

    expect(nudgesService.createRecommendedUpgradeRequest).not.toHaveBeenCalled();
  });

  it('allows operators to request an upgrade for their tenant', async () => {
    currentUser = {
      id: 'operator-1',
      email: 'operator@example.com',
      name: 'Operator One',
      memberships: [{ tenantId: 'tenant-1', roles: ['OPERATOR'] }],
    };

    await request(app.getHttpServer())
      .post('/me/ai/upgrade-request/recommended')
      .set('X-Tenant-Id', 'tenant-1')
      .send({ tenantId: 'tenant-1' })
      .expect(201);

    expect(nudgesService.createRecommendedUpgradeRequest).toHaveBeenCalledWith(
      currentUser,
      'tenant-1',
    );
  });
});
