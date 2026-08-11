import { ChargeStatus, PaymentStatus, Prisma } from '@prisma/client';
import { createLockedAllocation, reconcilePaymentWhenConsumed } from './payment-allocation-transaction';

describe('payment allocation transaction semantics', () => {
  const completeSnapshot = {
    functionalAmountMinor: 365000,
    functionalCurrencyCode: 'VES',
    exchangeRateId: 'rate-1',
    exchangeRateValue: new Prisma.Decimal('36.5'),
    exchangeRateDirection: 'DIRECT',
    exchangeRateEffectiveAt: new Date('2026-08-08T00:00:00.000Z'),
    conversionDate: new Date('2026-08-10T00:00:00.000Z'),
  };

  function transaction(payment: Record<string, unknown>) {
    const update = jest.fn().mockResolvedValue(undefined);
    const tx = {
      payment: {
        findUnique: jest.fn().mockResolvedValue(payment),
        update,
      },
    } as unknown as Prisma.TransactionClient;
    return { tx, update };
  }

  it('A: keeps a same-currency payment APPROVED while an original remainder is usable', async () => {
    const { tx, update } = transaction({
      id: 'payment', amount: 10000, currency: 'ARS', status: PaymentStatus.APPROVED,
      functionalAmountMinor: null, functionalCurrencyCode: null, exchangeRateId: null,
      exchangeRateValue: null, exchangeRateDirection: null, exchangeRateEffectiveAt: null,
      conversionDate: null,
      paymentAllocations: [{
        amount: 7000, paymentOriginalAmountMinor: 7000,
        charge: { currency: 'ARS', status: ChargeStatus.PAID },
      }],
    });
    await reconcilePaymentWhenConsumed(tx, 'payment');
    expect(update).not.toHaveBeenCalled();
  });

  it('B: reconciles 2740 + 2740 + 4520 only after exact functional consumption', async () => {
    const { tx, update } = transaction({
      id: 'payment', amount: 10000, currency: 'USD', status: PaymentStatus.APPROVED,
      ...completeSnapshot,
      paymentAllocations: [2740, 2740, 4520].map((share, index) => ({
        amount: [100000, 100000, 165000][index],
        paymentOriginalAmountMinor: share,
        charge: { currency: 'VES', status: ChargeStatus.PAID },
      })),
    });
    await reconcilePaymentWhenConsumed(tx, 'payment');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: PaymentStatus.RECONCILED }),
    }));
  });

  it('F: uses amount as the original share for legacy same-currency NULL allocations', async () => {
    const { tx, update } = transaction({
      id: 'payment', amount: 10000, currency: 'ARS', status: PaymentStatus.APPROVED,
      functionalAmountMinor: null, functionalCurrencyCode: null, exchangeRateId: null,
      exchangeRateValue: null, exchangeRateDirection: null, exchangeRateEffectiveAt: null,
      conversionDate: null,
      paymentAllocations: [{
        amount: 10000, paymentOriginalAmountMinor: null,
        charge: { currency: 'ARS', status: ChargeStatus.PAID },
      }],
    });
    await reconcilePaymentWhenConsumed(tx, 'payment');
    expect(update).toHaveBeenCalled();
  });

  it('G: never nominally falls back for a historical cross-currency NULL original share', async () => {
    const { tx, update } = transaction({
      id: 'payment', amount: 10000, currency: 'USD', status: PaymentStatus.APPROVED,
      ...completeSnapshot,
      paymentAllocations: [{
        amount: 365000, paymentOriginalAmountMinor: null,
        charge: { currency: 'VES', status: ChargeStatus.PAID },
      }],
    });
    await reconcilePaymentWhenConsumed(tx, 'payment');
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a non-full cross allocation with no original-backed functional amount', async () => {
    const create = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      payment: { findFirst: jest.fn().mockResolvedValue({
        id: 'payment', amount: 10000, currency: 'USD', status: PaymentStatus.APPROVED,
        ...completeSnapshot, functionalAmountMinor: 100,
        paymentAllocations: [{ amount: 9999, paymentOriginalAmountMinor: 9999, charge: { currency: 'USD' } }],
      }) },
      charge: { findFirst: jest.fn().mockResolvedValue({
        id: 'charge', amount: 100, currency: 'VES', paymentAllocations: [],
      }) },
      paymentAllocation: { create },
    } as unknown as Prisma.TransactionClient;

    await expect(createLockedAllocation(tx, {
      tenantId: 'tenant', buildingId: 'building', paymentId: 'payment', chargeId: 'charge',
    }, 1)).rejects.toMatchObject({ response: {
      statusCode: 422, error: 'PAYMENT_FUNCTIONAL_AMOUNT_EXCEEDED',
    } });
    expect(create).not.toHaveBeenCalled();
  });
});
