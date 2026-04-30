import { ForbiddenException } from '@nestjs/common';
import { OpsRepository } from './ops.repository';
import { OpsService } from './ops.service';

describe('OpsService', () => {
  const repository = {
    listAlerts: jest.fn(),
    findAlertById: jest.fn(),
    ackAlert: jest.fn(),
    resolveAlert: jest.fn(),
    upsertAlert: jest.fn(),
    listTenantIdsFromHandoffs: jest.fn(),
    getOpenCount: jest.fn(),
    getAssignP95Minutes: jest.fn(),
    getResolveP95Hours: jest.fn(),
    getBreachedSlaCount: jest.fn(),
    getTopFallbackPaths24h: jest.fn(),
    getGatewayErrorRate15m: jest.fn(),
    getP0NoDataRate15m: jest.fn(),
    getCacheHitRate15m: jest.fn(),
  } as unknown as jest.Mocked<OpsRepository>;

  let service: OpsService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.HITL_OPEN_THRESHOLD = '5';
    process.env.SLA_ASSIGN_MAX_MINUTES = '60';
    process.env.SLA_RESOLVE_MAX_HOURS = '24';
    process.env.AI_GATEWAY_ERROR_RATE_15M = '0.05';
    process.env.AI_P0_NO_DATA_RATE_15M = '0.10';
    process.env.CACHE_HIT_RATE_MIN = '0.30';

    repository.listTenantIdsFromHandoffs.mockResolvedValue(['tenant-a']);
    repository.getOpenCount.mockResolvedValue(12);
    repository.getAssignP95Minutes.mockResolvedValue(75);
    repository.getResolveP95Hours.mockResolvedValue(26);
    repository.getBreachedSlaCount.mockResolvedValue({ assign: 2, resolve: 1, total: 3 });
    repository.getTopFallbackPaths24h.mockResolvedValue([
      { fallbackPath: 'rag_no_sources', _count: { fallbackPath: 4 } },
    ] as any);
    repository.getGatewayErrorRate15m.mockResolvedValue({ rate: 0.2, total: 10 });
    repository.getP0NoDataRate15m.mockResolvedValue({ rate: 0.2, total: 10 });
    repository.getCacheHitRate15m.mockResolvedValue({ rate: 0.1, total: 10 });

    service = new OpsService(repository);
  });

  it('denies non-ops role access to metrics endpoints', async () => {
    await expect(
      service.getHitlMetrics(
        {
          userId: 'resident-1',
          isSuperAdmin: false,
          tenantId: 'tenant-a',
          roles: ['RESIDENT'],
        },
        'tenant-a',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('enforces tenant isolation for list alerts', async () => {
    await expect(
      service.listAlerts(
        {
          userId: 'ops-1',
          isSuperAdmin: false,
          tenantId: 'tenant-a',
          roles: ['TENANT_ADMIN'],
        },
        { tenantId: 'tenant-b' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates alert when open_count > threshold', async () => {
    await service.runMetricsCheck();

    expect(repository.upsertAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'HITL_BACKLOG_HIGH',
        tenantId: null,
        dedupeKey: 'global:HITL_BACKLOG_HIGH:15m',
      }),
    );
  });

  it('uses stable dedupeKey for tenant alerts', async () => {
    await service.runMetricsCheck();

    expect(repository.upsertAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'SLA_ASSIGN_P95_BREACH',
        tenantId: 'tenant-a',
        dedupeKey: 'tenant-a:SLA_ASSIGN_P95_BREACH:24h',
      }),
    );
  });
});
