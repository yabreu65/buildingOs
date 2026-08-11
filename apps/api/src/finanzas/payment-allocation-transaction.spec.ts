import { ChargeStatus, PaymentStatus, Prisma } from '@prisma/client';
import {
  assertPaymentAllocationCurrencyMode,
  calculateChargeAvailableOutstanding,
  createLockedAllocation,
  deleteLockedAllocation,
  reconcilePaymentWhenConsumed,
} from './payment-allocation-transaction';

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

  it.each([
    { existing: 'ARS', candidate: 'VES', label: 'SAME to CROSS' },
    { existing: 'VES', candidate: 'ARS', label: 'CROSS to SAME' },
  ])('rejects mixed allocation mode: $label', ({ existing, candidate }) => {
    expect(() => assertPaymentAllocationCurrencyMode(
      'ARS',
      [{ charge: { currency: existing } }],
      candidate,
    )).toThrow(expect.objectContaining({ response: {
      statusCode: 422,
      error: 'PAYMENT_ALLOCATION_CURRENCY_NOT_SUPPORTED',
    } }));
  });

  it.each([
    { currency: 'ARS', label: 'SAME' },
    { currency: 'VES', label: 'CROSS' },
  ])('allows two pure $label allocations', ({ currency }) => {
    expect(() => assertPaymentAllocationCurrencyMode(
      'ARS',
      [{ charge: { currency } }],
      currency,
    )).not.toThrow();
  });

  it('keeps a pure SAME payment with a COMPLETE cross-capable snapshot APPROVED while an original remainder remains', async () => {
    const { tx, update } = transaction({
      id: 'payment', amount: 10000, currency: 'USD', status: PaymentStatus.APPROVED,
      ...completeSnapshot,
      paymentAllocations: [{
        amount: 7000, paymentOriginalAmountMinor: 7000,
        charge: { currency: 'USD', status: ChargeStatus.PAID },
      }],
    });
    await reconcilePaymentWhenConsumed(tx, 'payment');
    expect(update).not.toHaveBeenCalled();
  });

  it('reconciles a fully consumed pure SAME payment with a COMPLETE cross-capable snapshot', async () => {
    const { tx, update } = transaction({
      id: 'payment', amount: 10000, currency: 'USD', status: PaymentStatus.APPROVED,
      ...completeSnapshot,
      paymentAllocations: [{
        amount: 10000, paymentOriginalAmountMinor: 10000,
        charge: { currency: 'USD', status: ChargeStatus.PAID },
      }],
    });
    await reconcilePaymentWhenConsumed(tx, 'payment');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: PaymentStatus.RECONCILED }),
    }));
  });

  it('reconciles a pure CROSS payment only after exact original and functional consumption', async () => {
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

  it('keeps a pure CROSS payment APPROVED while a functional remainder remains', async () => {
    const { tx, update } = transaction({
      id: 'payment', amount: 10000, currency: 'USD', status: PaymentStatus.APPROVED,
      ...completeSnapshot,
      paymentAllocations: [{
        amount: 300000, paymentOriginalAmountMinor: 10000,
        charge: { currency: 'VES', status: ChargeStatus.PAID },
      }],
    });
    await reconcilePaymentWhenConsumed(tx, 'payment');
    expect(update).not.toHaveBeenCalled();
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

  it('blocks reconciliation for a historical mixed-mode payment without mutation', async () => {
    const { tx, update } = transaction({
      id: 'payment', amount: 10000, currency: 'ARS', status: PaymentStatus.APPROVED,
      ...completeSnapshot,
      paymentAllocations: [
        { amount: 5000, paymentOriginalAmountMinor: 5000, charge: { currency: 'ARS', status: ChargeStatus.PAID } },
        { amount: 182500, paymentOriginalAmountMinor: 5000, charge: { currency: 'VES', status: ChargeStatus.PAID } },
      ],
    });

    await expect(reconcilePaymentWhenConsumed(tx, 'payment')).rejects.toMatchObject({
      response: { statusCode: 422, error: 'PAYMENT_ALLOCATION_CURRENCY_NOT_SUPPORTED' },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'SAME',
      payment: {
        id: 'payment', amount: 10000, currency: 'USD', status: PaymentStatus.RECONCILED,
        ...completeSnapshot,
        paymentAllocations: [{
          amount: 7000, paymentOriginalAmountMinor: 7000,
          charge: { currency: 'USD', status: ChargeStatus.PAID },
        }],
      },
    },
    {
      label: 'CROSS',
      payment: {
        id: 'payment', amount: 10000, currency: 'USD', status: PaymentStatus.RECONCILED,
        ...completeSnapshot,
        paymentAllocations: [{
          amount: 300000, paymentOriginalAmountMinor: 8000,
          charge: { currency: 'VES', status: ChargeStatus.PAID },
        }],
      },
    },
  ])('downgrades incomplete RECONCILED $label payments to APPROVED', async ({ payment }) => {
    const { tx, update } = transaction(payment);
    await reconcilePaymentWhenConsumed(tx, 'payment');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: PaymentStatus.APPROVED }),
    }));
  });

  it('keeps PARTIAL_INVALID reconciliation fail closed without mutation', async () => {
    const { tx, update } = transaction({
      id: 'payment', amount: 10000, currency: 'USD', status: PaymentStatus.RECONCILED,
      ...completeSnapshot, exchangeRateId: null,
      paymentAllocations: [],
    });
    await reconcilePaymentWhenConsumed(tx, 'payment');
    expect(update).not.toHaveBeenCalled();
  });

  it('counts effective and SUBMITTED reservations while excluding the current payment once', () => {
    const allocations = [
      { amount: 2000, payment: { id: 'effective', status: PaymentStatus.APPROVED } },
      { amount: 3000, payment: { id: 'submitted', status: PaymentStatus.SUBMITTED } },
      { amount: 7000, payment: { id: 'current', status: PaymentStatus.SUBMITTED } },
    ];
    expect(calculateChargeAvailableOutstanding(12000, allocations, 'current')).toBe(7000);
    expect(calculateChargeAvailableOutstanding(12000, allocations)).toBe(0);
  });

  it('deletes under Payment then Charge locks, recalculates, and downgrades reconciliation', async () => {
    const calls: string[] = [];
    const tx = {
      $queryRaw: jest.fn().mockImplementation(async () => { calls.push('lock'); return []; }),
      paymentAllocation: {
        findFirst: jest.fn()
          .mockResolvedValueOnce({ paymentId: 'payment', chargeId: 'charge' })
          .mockResolvedValueOnce({ id: 'allocation', paymentId: 'payment', chargeId: 'charge', amount: 10000 }),
        deleteMany: jest.fn().mockImplementation(async () => { calls.push('delete'); return { count: 1 }; }),
      },
      charge: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'charge', amount: 10000, status: ChargeStatus.PAID, paymentAllocations: [],
        }),
        update: jest.fn().mockImplementation(async () => { calls.push('charge'); }),
      },
      payment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'payment', amount: 10000, currency: 'ARS', status: PaymentStatus.RECONCILED,
          functionalAmountMinor: null, functionalCurrencyCode: null, exchangeRateId: null,
          exchangeRateValue: null, exchangeRateDirection: null, exchangeRateEffectiveAt: null,
          conversionDate: null, paymentAllocations: [],
        }),
        update: jest.fn().mockImplementation(async () => { calls.push('payment'); }),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(deleteLockedAllocation(tx, 'tenant', 'building', 'allocation')).resolves.toEqual({
      id: 'allocation', paymentId: 'payment', chargeId: 'charge', amount: 10000,
    });
    expect(calls).toEqual(['lock', 'lock', 'delete', 'charge', 'payment']);
  });

  it.each([
    { label: 'stale discovery', authoritative: null, deleted: 1 },
    { label: 'double delete', authoritative: { id: 'allocation', paymentId: 'payment', chargeId: 'charge', amount: 1 }, deleted: 0 },
  ])('returns canonical 404 for $label', async ({ authoritative, deleted }) => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      paymentAllocation: {
        findFirst: jest.fn()
          .mockResolvedValueOnce({ paymentId: 'payment', chargeId: 'charge' })
          .mockResolvedValueOnce(authoritative),
        deleteMany: jest.fn().mockResolvedValue({ count: deleted }),
      },
    } as unknown as Prisma.TransactionClient;
    await expect(deleteLockedAllocation(tx, 'tenant', 'building', 'allocation')).rejects.toMatchObject({
      status: 404,
      response: expect.objectContaining({
        statusCode: 404,
        message: 'Allocation not found or does not belong to this tenant',
      }),
    });
  });

  it('rejects a non-full cross allocation with no original-backed functional amount', async () => {
    const create = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      payment: { findFirst: jest.fn().mockResolvedValue({
        id: 'payment', amount: 10000, currency: 'USD', status: PaymentStatus.APPROVED,
        ...completeSnapshot, functionalAmountMinor: 102,
        paymentAllocations: [{ amount: 100, paymentOriginalAmountMinor: 9999, charge: { currency: 'VES' } }],
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
