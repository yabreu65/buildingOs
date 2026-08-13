import { ForbiddenException } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import type { AuthenticatedRequest } from '../common/types/request.types';
import type { DashboardSummaryDto } from './dashboard.dto';

const stubReq = (
  roles: string[],
  overrides: Record<string, unknown> = {},
): AuthenticatedRequest =>
  ({
    tenantId: 'tenant-1',
    user: {
      id: 'user-1',
      email: 'admin@test.com',
      roles,
    },
    ...overrides,
  }) as AuthenticatedRequest;

describe('DashboardController admin summary access', () => {
  let controller: DashboardController;
  let service: { getSummary: jest.Mock };

  beforeEach(() => {
    service = {
      getSummary: jest.fn(),
    };

    controller = new DashboardController(service as never);
  });

  it('blocks residents, empty roles, unknown roles and invalid admin headers from the admin dashboard summary', async () => {
    await expect(
      controller.getAdminSummary(
        { period: '2026-05' } as never,
        stubReq(['RESIDENT']),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      controller.getAdminSummary(
        { period: '2026-05' } as never,
        stubReq([]),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      controller.getAdminSummary(
        { period: '2026-05' } as never,
        stubReq(['MANAGER']),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      controller.getAdminSummary(
        { period: '2026-05' } as never,
        stubReq(['RESIDENT', 'TENANT_ADMIN']),
        'resident',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      controller.getAdminSummary(
        { period: '2026-05' } as never,
        stubReq(['TENANT_ADMIN']),
        'admin ',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(service.getSummary).not.toHaveBeenCalled();
  });

  it('allows administrative roles with admin context and preserves the no-header compatible path', async () => {
    const summary: DashboardSummaryDto = {
      kpis: {
        outstandingByCurrency: [{ currency: 'ARS', amountMinor: 1000 }],
        collectedByCurrency: [{ currency: 'ARS', amountMinor: 200 }],
        collectionRateByCurrency: [{ currency: 'ARS', rate: 20 }],
        delinquentUnits: 1,
      },
      queues: {
        tickets: { open: 1, inProgress: 0, overdue: 0, top: [] },
        paymentsToValidate: { count: 2, top: [] },
        unitsWithoutResponsible: { count: 0, top: [] },
      },
      buildingAlerts: [],
      quickActions: ['finance'],
      metadata: {
        period: '2026-05',
        buildingId: null,
        generatedAt: '2026-05-24T00:00:00.000Z',
      },
    };
    service.getSummary.mockResolvedValue(summary);

    await expect(
      controller.getAdminSummary(
        { period: '2026-05' } as never,
        stubReq(['TENANT_ADMIN']),
      ),
    ).resolves.toBe(summary);

    await expect(
      controller.getAdminSummary(
        { period: '2026-05' } as never,
        stubReq(['SUPER_ADMIN'], {
          headers: { 'x-portal-context': 'admin' },
        }),
        'admin',
      ),
    ).resolves.toBe(summary);

    await expect(
      controller.getAdminSummary(
        { period: '2026-05' } as never,
        stubReq(['RESIDENT', 'TENANT_OWNER']),
      ),
    ).resolves.toBe(summary);

    await expect(
      controller.getAdminSummary(
        { period: '2026-05' } as never,
        stubReq(['RESIDENT', 'OPERATOR'], {
          headers: { 'x-portal-context': 'admin' },
        }),
        'admin',
      ),
    ).resolves.toBe(summary);

    expect(service.getSummary).toHaveBeenCalledWith('tenant-1', { period: '2026-05' });
  });
});
