import { BadRequestException } from '@nestjs/common';
import { PaymentStatus, ReceiptStatus } from '@prisma/client';
import { FinanzasService } from './finanzas.service';

interface RetryPayment {
  readonly status: PaymentStatus;
  readonly canceledAt: Date | null;
  readonly receiptStatus: ReceiptStatus;
  readonly receiptNumber: string | null;
}

describe('FinanzasService receipt retry eligibility', () => {
  function buildService(payment: RetryPayment, result: object | null) {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(payment)
      .mockResolvedValue({ receiptError: 'generation failed' });
    const receiptService = {
      ensureReceiptForPayment: jest.fn().mockResolvedValue(result),
    };
    const validators = {
      canReviewPayments: jest.fn().mockReturnValue(true),
      throwForbidden: jest.fn(),
    };
    const service = Object.create(FinanzasService.prototype) as FinanzasService;
    Reflect.set(service, 'validators', validators);
    Reflect.set(service, 'prisma', { payment: { findFirst } });
    Reflect.set(service, 'receiptService', receiptService);
    return { service, findFirst, receiptService };
  }

  it.each([PaymentStatus.APPROVED, PaymentStatus.RECONCILED])(
    'allows %s payments to recover a missing receipt without trusting receiptNumber',
    async (status) => {
      const ctx = buildService(
        {
          status,
          canceledAt: null,
          receiptStatus: ReceiptStatus.PENDING,
          receiptNumber: 'R-LEGACY-2026-000001',
        },
        { receiptNumber: 'R-LEGACY-2026-000001' },
      );

      await expect(
        ctx.service.retryReceiptGeneration('tenant-1', 'payment-1', [
          'TENANT_ADMIN',
        ]),
      ).resolves.toEqual({
        success: true,
        receiptNumber: 'R-LEGACY-2026-000001',
      });

      expect(ctx.receiptService.ensureReceiptForPayment).toHaveBeenCalledWith(
        'tenant-1',
        'payment-1',
        undefined,
      );
    },
  );

  it('does not report success when a numbered pending receipt cannot be recovered', async () => {
    const ctx = buildService(
      {
        status: PaymentStatus.APPROVED,
        canceledAt: null,
        receiptStatus: ReceiptStatus.PENDING,
        receiptNumber: 'R-LEGACY-2026-000001',
      },
      null,
    );

    await expect(
      ctx.service.retryReceiptGeneration('tenant-1', 'payment-1', [
        'TENANT_ADMIN',
      ]),
    ).resolves.toEqual({ success: false, error: 'generation failed' });
    expect(ctx.receiptService.ensureReceiptForPayment).toHaveBeenCalledTimes(1);
  });

  it.each([PaymentStatus.SUBMITTED, PaymentStatus.REJECTED])(
    'rejects %s payments as ineligible for receipt recovery',
    async (status) => {
      const ctx = buildService(
        {
          status,
          canceledAt: null,
          receiptStatus: ReceiptStatus.PENDING,
          receiptNumber: null,
        },
        null,
      );

      await expect(
        ctx.service.retryReceiptGeneration('tenant-1', 'payment-1', [
          'TENANT_ADMIN',
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(ctx.receiptService.ensureReceiptForPayment).not.toHaveBeenCalled();
    },
  );

  it('rejects a canceled approved payment', async () => {
    const ctx = buildService(
      {
        status: PaymentStatus.APPROVED,
        canceledAt: new Date('2026-08-01T00:00:00.000Z'),
        receiptStatus: ReceiptStatus.PENDING,
        receiptNumber: null,
      },
      null,
    );

    await expect(
      ctx.service.retryReceiptGeneration('tenant-1', 'payment-1', [
        'TENANT_ADMIN',
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.receiptService.ensureReceiptForPayment).not.toHaveBeenCalled();
  });
});
