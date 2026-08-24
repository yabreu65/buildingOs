import { ForbiddenException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { TenantFinanceController } from './tenant-finance.controller';
import type { AuthenticatedRequest } from '../common/types/request.types';
import type { Payment } from '@prisma/client';

const stubReq = (
  roles: string[],
  overrides: Record<string, unknown> = {},
): AuthenticatedRequest =>
  ({
    tenantId: 'tenant-1',
    user: {
      id: 'user-1',
      email: 'admin@test.com',
      membershipId: 'member-1',
      roles,
    },
    ...overrides,
  }) as AuthenticatedRequest;

describe('TenantFinanceController administrative portal access', () => {
  let controller: TenantFinanceController;
  let service: {
    getTenantFinancialSummary: jest.Mock;
    listTenantCharges: jest.Mock;
    listPendingPayments: jest.Mock;
    approvePaymentTenant: jest.Mock;
    rejectPaymentTenant: jest.Mock;
    getPaymentMetrics: jest.Mock;
    getPaymentAuditLog: jest.Mock;
    checkPaymentDuplicate: jest.Mock;
    retryReceiptGeneration: jest.Mock;
  };

  beforeEach(() => {
    service = {
      getTenantFinancialSummary: jest.fn(),
      listTenantCharges: jest.fn(),
      listPendingPayments: jest.fn(),
      approvePaymentTenant: jest.fn(),
      rejectPaymentTenant: jest.fn(),
      getPaymentMetrics: jest.fn(),
      getPaymentAuditLog: jest.fn(),
      checkPaymentDuplicate: jest.fn(),
      retryReceiptGeneration: jest.fn(),
    };

    controller = new TenantFinanceController(service as never);
  });

  it('fails closed for residents, invalid headers, empty roles and unknown roles before any service call', async () => {
    await expect(
      controller.getTenantFinancialSummary({}, stubReq(['RESIDENT'])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.getTenantFinancialSummary({}, stubReq(['RESIDENT']), 'resident'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.getTenantFinancialSummary({}, stubReq(['RESIDENT']), 'admin'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.getTenantFinancialSummary({}, stubReq([])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.listPendingPayments({}, stubReq(['RESIDENT']), 'resident'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.getPaymentMetrics({}, stubReq(['RESIDENT']), 'admin '),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.getPaymentAuditLog('payment-1', {}, stubReq(['RESIDENT'])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.checkPaymentDuplicate('payment-1', stubReq(['RESIDENT']), 'resident'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.approvePayment('payment-1', {} as never, stubReq(['RESIDENT']), 'admin'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.rejectPayment('payment-1', {} as never, stubReq(['RESIDENT'])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.retryReceiptGeneration('payment-1', stubReq(['RESIDENT']), 'resident'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(service.getTenantFinancialSummary).not.toHaveBeenCalled();
    expect(service.listTenantCharges).not.toHaveBeenCalled();
    expect(service.listPendingPayments).not.toHaveBeenCalled();
    expect(service.getPaymentMetrics).not.toHaveBeenCalled();
    expect(service.getPaymentAuditLog).not.toHaveBeenCalled();
    expect(service.checkPaymentDuplicate).not.toHaveBeenCalled();
    expect(service.approvePaymentTenant).not.toHaveBeenCalled();
    expect(service.rejectPaymentTenant).not.toHaveBeenCalled();
    expect(service.retryReceiptGeneration).not.toHaveBeenCalled();
  });

  it('allows resident access to tenant-scoped charge listings while preserving admin restrictions elsewhere', async () => {
    const charges = [{ id: 'charge-1', tenantId: 'tenant-1' }];
    service.listTenantCharges.mockResolvedValue(charges);

    await expect(
      controller.listTenantCharges(
        { status: 'OPEN' },
        stubReq(['RESIDENT']),
      ),
    ).resolves.toBe(charges);

    expect(service.listTenantCharges).toHaveBeenCalledWith(
      'tenant-1',
      ['RESIDENT'],
      'user-1',
      { status: 'OPEN' },
    );
  });

  it('allows administrative roles with canonical admin context and preserves the no-header compatible path', async () => {
    const summary = {
      totalCharges: 100,
      totalPaid: 20,
      totalOutstanding: 80,
      delinquentUnitsCount: 2,
      topDelinquentUnits: [],
      currency: 'ARS',
      period: '2026-05',
      buildingId: null,
    };
    const charges = [{ id: 'charge-1' }];
    const pendingPayments: Payment[] = [
      { id: 'payment-1', tenantId: 'tenant-1', buildingId: 'building-1', status: PaymentStatus.SUBMITTED } as Payment,
    ];
    const metrics = {
      backlogCount: 1,
      backlogAmount: 100,
      agingMedianDays: 2,
      agingP95Days: 3,
      totalReviewed: 4,
      approvalRate: 75,
      rejectionRate: 25,
      rejectionReasons: [],
      byBuilding: [],
    };
    const auditLog = [];
    const duplicate = {
      hasDuplicate: false,
      duplicatePaymentId: undefined,
      duplicateAmount: undefined,
      duplicateReference: undefined,
      duplicateCreatedAt: undefined,
    };
    const approval = { id: 'payment-1', tenantId: 'tenant-1' } as Payment;

    service.getTenantFinancialSummary.mockResolvedValue(summary);
    service.listTenantCharges.mockResolvedValue(charges);
    service.listPendingPayments.mockResolvedValue(pendingPayments);
    service.getPaymentMetrics.mockResolvedValue(metrics);
    service.getPaymentAuditLog.mockResolvedValue(auditLog);
    service.checkPaymentDuplicate.mockResolvedValue(duplicate);
    service.approvePaymentTenant.mockResolvedValue(approval);
    service.rejectPaymentTenant.mockResolvedValue(approval);
    service.retryReceiptGeneration.mockResolvedValue(approval);

    await expect(
      controller.getTenantFinancialSummary(
        { period: '2026-05' },
        stubReq(['TENANT_ADMIN']),
      ),
    ).resolves.toBe(summary);

    await expect(
      controller.listTenantCharges(
        {},
        stubReq(['SUPER_ADMIN'], { headers: { 'x-portal-context': 'admin' } }),
      ),
    ).resolves.toBe(charges);

    await expect(
      controller.listPendingPayments(
        { status: PaymentStatus.SUBMITTED },
        stubReq(['TENANT_OWNER']),
      ),
    ).resolves.toBe(pendingPayments);

    await expect(
      controller.getPaymentMetrics(
        {},
        stubReq(['OPERATOR'], { headers: { 'x-portal-context': 'admin' } }),
        'admin',
      ),
    ).resolves.toBe(metrics);

    await expect(
      controller.getPaymentAuditLog(
        'payment-1',
        { limit: 10 },
        stubReq(['TENANT_ADMIN']),
      ),
    ).resolves.toBe(auditLog);

    await expect(
      controller.checkPaymentDuplicate(
        'payment-1',
        stubReq(['TENANT_ADMIN'], { headers: { 'x-portal-context': 'admin' } }),
        'admin',
      ),
    ).resolves.toBe(duplicate);

    await expect(
      controller.approvePayment(
        'payment-1',
        {} as never,
        stubReq(['TENANT_ADMIN']),
      ),
    ).resolves.toBe(approval);

    await expect(
      controller.rejectPayment(
        'payment-1',
        {} as never,
        stubReq(['TENANT_ADMIN'], { headers: { 'x-portal-context': 'admin' } }),
        'admin',
      ),
    ).resolves.toBe(approval);

    await expect(
      controller.retryReceiptGeneration(
        'payment-1',
        stubReq(['RESIDENT', 'TENANT_ADMIN']),
      ),
    ).resolves.toBe(approval);

    expect(service.getTenantFinancialSummary).toHaveBeenCalledWith(
      'tenant-1',
      '2026-05',
      ['TENANT_ADMIN'],
      'user-1',
    );
    expect(service.listTenantCharges).toHaveBeenCalledWith(
      'tenant-1',
      ['SUPER_ADMIN'],
      'user-1',
      {},
    );
    expect(service.listPendingPayments).toHaveBeenCalledWith(
      'tenant-1',
      ['TENANT_OWNER'],
      'user-1',
      { status: PaymentStatus.SUBMITTED },
    );
    expect(service.getPaymentMetrics).toHaveBeenCalledWith('tenant-1', {});
    expect(service.getPaymentAuditLog).toHaveBeenCalledWith(
      'tenant-1',
      'payment-1',
      { limit: 10 },
    );
    expect(service.checkPaymentDuplicate).toHaveBeenCalledWith('tenant-1', 'payment-1');
    expect(service.approvePaymentTenant).toHaveBeenCalledWith(
      'tenant-1',
      'payment-1',
      ['TENANT_ADMIN'],
      'member-1',
      {},
      'user-1',
    );
    expect(service.rejectPaymentTenant).toHaveBeenCalledWith(
      'tenant-1',
      'payment-1',
      ['TENANT_ADMIN'],
      'member-1',
      {},
    );
    expect(service.retryReceiptGeneration).toHaveBeenCalledWith(
      'tenant-1',
      'payment-1',
      ['RESIDENT', 'TENANT_ADMIN'],
      'user-1',
    );
  });
});
