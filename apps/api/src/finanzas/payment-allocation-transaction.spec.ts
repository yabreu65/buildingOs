import { ChargeStatus, PaymentAuditAction, PaymentStatus, Prisma } from '@prisma/client';
import {
  aggregatePaymentSideAllocations,
  assertPaymentAllocationCurrencyMode,
  calculateChargeAvailableOutstanding,
  classifyPaymentSideAllocations,
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
    const paymentAuditLog = { create: jest.fn().mockResolvedValue(undefined) };
    const tx = {
      payment: {
        findUnique: jest.fn().mockResolvedValue(payment),
        update,
      },
      paymentAuditLog,
    } as unknown as Prisma.TransactionClient;
    return { tx, update, paymentAuditLog };
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

  it('aggregates SAME explicit and legacy shares in original minor units', () => {
    expect(aggregatePaymentSideAllocations({
      id: 'payment', amount: 10000, currency: 'USD',
      functionalAmountMinor: null, functionalCurrencyCode: null, exchangeRateId: null,
      exchangeRateValue: null, exchangeRateDirection: null, exchangeRateEffectiveAt: null,
      conversionDate: null,
      paymentAllocations: [
        { amount: 2500, paymentOriginalAmountMinor: 2500, charge: { currency: 'USD' } },
        { amount: 1500, paymentOriginalAmountMinor: null, charge: { currency: 'USD' } },
      ],
    })).toEqual({
      mode: 'SAME',
      originalConsumedMinor: 4000,
      originalRemainingMinor: 6000,
      functionalConsumedMinor: null,
      functionalRemainingMinor: null,
    });
  });

  it('aggregates partial and full CROSS consumption in both currencies', () => {
    const payment = {
      id: 'payment', amount: 10000, currency: 'USD', ...completeSnapshot,
      paymentAllocations: [2740, 2740].map((share) => ({
        amount: 100000, paymentOriginalAmountMinor: share, charge: { currency: 'VES' },
      })),
    };
    expect(aggregatePaymentSideAllocations(payment)).toEqual({
      mode: 'CROSS', originalConsumedMinor: 5480, originalRemainingMinor: 4520,
      functionalConsumedMinor: 200000, functionalRemainingMinor: 165000,
    });
    expect(aggregatePaymentSideAllocations({
      ...payment,
      paymentAllocations: [
        ...payment.paymentAllocations,
        { amount: 165000, paymentOriginalAmountMinor: 4520, charge: { currency: 'VES' } },
      ],
    })).toEqual({
      mode: 'CROSS', originalConsumedMinor: 10000, originalRemainingMinor: 0,
      functionalConsumedMinor: 365000, functionalRemainingMinor: 0,
    });
  });

  it('fails closed for a legacy CROSS NULL original share', () => {
    const payment = {
      id: 'payment', amount: 10000, currency: 'USD', ...completeSnapshot,
      paymentAllocations: [{
        amount: 365000, paymentOriginalAmountMinor: null, charge: { currency: 'VES' },
      }],
    };
    expect(classifyPaymentSideAllocations(payment)).toEqual({
      kind: 'UNRESOLVED_LEGACY_CROSS',
      aggregate: null,
    });
    expect(() => aggregatePaymentSideAllocations(payment)).toThrow(expect.objectContaining({ response: {
      statusCode: 422, error: 'PAYMENT_LEGACY_SNAPSHOT_REQUIRED',
    } }));
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
    const { tx, update, paymentAuditLog } = transaction({
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
    expect(paymentAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentId: 'payment',
        action: PaymentAuditAction.RECONCILED,
      }),
    });
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

  it('G: fails closed for a historical cross-currency NULL original share', async () => {
    const { tx, update } = transaction({
      id: 'payment', amount: 10000, currency: 'USD', status: PaymentStatus.APPROVED,
      ...completeSnapshot,
      paymentAllocations: [{
        amount: 365000, paymentOriginalAmountMinor: null,
        charge: { currency: 'VES', status: ChargeStatus.PAID },
      }],
    });
    await expect(reconcilePaymentWhenConsumed(tx, 'payment')).rejects.toMatchObject({
      response: { statusCode: 422, error: 'PAYMENT_LEGACY_SNAPSHOT_REQUIRED' },
    });
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

  it('progressively cleans a mixed ledger without deriving malformed capacity, then resumes canonical reconciliation', async () => {
    const calls: string[] = [];
    const allocations = [
      { id: 'same-a', paymentId: 'payment', chargeId: 'same-charge-a', amount: 4000,
        paymentOriginalAmountMinor: 4000, charge: { currency: 'USD', status: ChargeStatus.PAID } },
      { id: 'same-b', paymentId: 'payment', chargeId: 'same-charge-b', amount: 10000,
        paymentOriginalAmountMinor: 10000, charge: { currency: 'USD', status: ChargeStatus.PAID } },
      { id: 'cross-a', paymentId: 'payment', chargeId: 'cross-charge-a', amount: 100000,
        paymentOriginalAmountMinor: null, charge: { currency: 'VES', status: ChargeStatus.PAID } },
      { id: 'cross-b', paymentId: 'payment', chargeId: 'cross-charge-b', amount: 265000,
        paymentOriginalAmountMinor: null, charge: { currency: 'VES', status: ChargeStatus.PAID } },
    ];
    let paymentStatus = PaymentStatus.RECONCILED;
    const tx = {
      $queryRaw: jest.fn().mockImplementation(async () => { calls.push('lock'); return []; }),
      paymentAllocation: {
        findFirst: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
          const allocation = allocations.find((item) => item.id === where.id);
          return allocation && (where.payment === undefined
            ? { paymentId: allocation.paymentId, chargeId: allocation.chargeId }
            : { id: allocation.id, paymentId: allocation.paymentId, chargeId: allocation.chargeId,
                amount: allocation.amount });
        }),
        deleteMany: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
          calls.push(`delete:${where.id}`);
          const index = allocations.findIndex((item) => item.id === where.id);
          if (index < 0) return { count: 0 };
          allocations.splice(index, 1);
          return { count: 1 };
        }),
      },
      charge: {
        findUnique: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => ({
          id: where.id, amount: 10000,
          status: ChargeStatus.PAID, paymentAllocations: [],
        })),
        update: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
          calls.push(`charge:${where.id}`);
        }),
      },
      payment: {
        findUnique: jest.fn().mockImplementation(async () => ({
          id: 'payment', amount: 10000, currency: 'USD', status: paymentStatus, ...completeSnapshot,
          paymentAllocations: allocations,
        })),
        update: jest.fn().mockImplementation(async ({ data }: { data: { status: PaymentStatus } }) => {
          paymentStatus = data.status;
          calls.push(`payment:${data.status}`);
        }),
      },
      paymentAuditLog: { create: jest.fn().mockResolvedValue(undefined) },
    } as unknown as Prisma.TransactionClient;

    await deleteLockedAllocation(tx, 'tenant', 'building', 'same-a');
    expect(allocations).toHaveLength(3);
    expect(classifyPaymentSideAllocations({
      id: 'payment', amount: 10000, currency: 'USD', ...completeSnapshot,
      paymentAllocations: allocations,
    })).toMatchObject({ kind: 'MIXED' });
    expect(paymentStatus).toBe(PaymentStatus.APPROVED);

    await deleteLockedAllocation(tx, 'tenant', 'building', 'cross-a');
    expect(allocations).toHaveLength(2);
    expect(paymentStatus).toBe(PaymentStatus.APPROVED);

    await deleteLockedAllocation(tx, 'tenant', 'building', 'cross-b');
    expect(allocations).toHaveLength(1);
    expect(aggregatePaymentSideAllocations({
      id: 'payment', amount: 10000, currency: 'USD', ...completeSnapshot,
      paymentAllocations: allocations,
    })).toMatchObject({ mode: 'SAME', originalRemainingMinor: 0 });
    expect(paymentStatus).toBe(PaymentStatus.RECONCILED);

    await deleteLockedAllocation(tx, 'tenant', 'building', 'same-b');
    expect(allocations).toHaveLength(0);
    expect(paymentStatus).toBe(PaymentStatus.APPROVED);
    expect(calls).toContain('payment:APPROVED');
  });

  it('derives canonical status after deleting the unresolved row from a mixed known CROSS ledger', async () => {
    const known = { id: 'known', paymentId: 'payment', chargeId: 'known-charge', amount: 365000,
      paymentOriginalAmountMinor: 10000, charge: { currency: 'VES', status: ChargeStatus.PAID } };
    const unresolved = { id: 'unresolved', paymentId: 'payment', chargeId: 'legacy-charge', amount: 1,
      paymentOriginalAmountMinor: null, charge: { currency: 'VES', status: ChargeStatus.PAID } };
    const allocations = [known, unresolved];
    const update = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      paymentAllocation: {
        findFirst: jest.fn().mockResolvedValueOnce({ paymentId: 'payment', chargeId: 'legacy-charge' })
          .mockResolvedValueOnce({ id: 'unresolved', paymentId: 'payment', chargeId: 'legacy-charge', amount: 1 }),
        deleteMany: jest.fn().mockImplementation(async () => { allocations.pop(); return { count: 1 }; }),
      },
      charge: { findUnique: jest.fn().mockResolvedValue({
        id: 'legacy-charge', amount: 1, status: ChargeStatus.PAID, paymentAllocations: [],
      }), update: jest.fn() },
      payment: {
        findUnique: jest.fn().mockImplementation(async () => ({
          id: 'payment', amount: 10000, currency: 'USD', status: PaymentStatus.APPROVED,
          ...completeSnapshot, paymentAllocations: allocations,
        })),
        update,
      },
      paymentAuditLog: { create: jest.fn().mockResolvedValue(undefined) },
    } as unknown as Prisma.TransactionClient;

    await deleteLockedAllocation(tx, 'tenant', 'building', 'unresolved');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: PaymentStatus.RECONCILED }),
    }));
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

  it('rejects create when an existing legacy CROSS share is NULL without mutation', async () => {
    const create = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      payment: { findFirst: jest.fn().mockResolvedValue({
        id: 'payment', amount: 10000, currency: 'USD', status: PaymentStatus.APPROVED,
        ...completeSnapshot,
        paymentAllocations: [{
          chargeId: 'legacy-charge', amount: 100000, paymentOriginalAmountMinor: null,
          charge: { currency: 'VES' },
        }],
      }) },
      charge: { findFirst: jest.fn().mockResolvedValue({
        id: 'new-charge', amount: 100000, currency: 'VES', paymentAllocations: [],
      }) },
      paymentAllocation: { create },
    } as unknown as Prisma.TransactionClient;

    await expect(createLockedAllocation(tx, {
      tenantId: 'tenant', buildingId: 'building', paymentId: 'payment', chargeId: 'new-charge',
    }, 100000)).rejects.toMatchObject({
      response: { statusCode: 422, error: 'PAYMENT_LEGACY_SNAPSHOT_REQUIRED' },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'LEGACY_NULL', snapshot: {
      functionalAmountMinor: null, functionalCurrencyCode: null, exchangeRateId: null,
      exchangeRateValue: null, exchangeRateDirection: null, exchangeRateEffectiveAt: null,
      conversionDate: null,
    } },
    { label: 'PARTIAL_INVALID', snapshot: { ...completeSnapshot, exchangeRateId: null } },
  ])('commits a CROSS delete when the remaining snapshot is $label and downgrades conservatively', async ({ snapshot }) => {
    const allocations = [
      { id: 'a', paymentId: 'payment', chargeId: 'charge-a', amount: 100000,
        paymentOriginalAmountMinor: 2740, charge: { currency: 'VES', status: ChargeStatus.PAID } },
      { id: 'b', paymentId: 'payment', chargeId: 'charge-b', amount: 100000,
        paymentOriginalAmountMinor: 2740, charge: { currency: 'VES', status: ChargeStatus.PAID } },
    ];
    let paymentStatus = PaymentStatus.RECONCILED;
    const update = jest.fn().mockImplementation(async ({ data }: { data: { status: PaymentStatus } }) => {
      paymentStatus = data.status;
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      paymentAllocation: {
        findFirst: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
          const allocation = allocations.find((item) => item.id === where.id);
          return allocation && (where.payment === undefined
            ? { paymentId: allocation.paymentId, chargeId: allocation.chargeId }
            : { id: allocation.id, paymentId: allocation.paymentId, chargeId: allocation.chargeId,
                amount: allocation.amount });
        }),
        deleteMany: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
          const index = allocations.findIndex((item) => item.id === where.id);
          if (index < 0) return { count: 0 };
          allocations.splice(index, 1);
          return { count: 1 };
        }),
      },
      charge: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'charge-a', amount: 100000, status: ChargeStatus.PAID, paymentAllocations: [],
        }),
        update: jest.fn(),
      },
      payment: {
        findUnique: jest.fn().mockImplementation(async () => ({
          id: 'payment', amount: 10000, currency: 'USD', status: paymentStatus, ...snapshot,
          paymentAllocations: allocations,
        })),
        update,
      },
    } as unknown as Prisma.TransactionClient;

    await expect(deleteLockedAllocation(tx, 'tenant', 'building', 'a')).resolves.toEqual({
      id: 'a', paymentId: 'payment', chargeId: 'charge-a', amount: 100000,
    });
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({ id: 'b' });
    expect(paymentStatus).toBe(PaymentStatus.APPROVED);
  });

  it('resumes canonical reconciliation once the last unresolved-snapshot CROSS row is deleted', async () => {
    const known = { id: 'known', paymentId: 'payment', chargeId: 'known-charge', amount: 365000,
      paymentOriginalAmountMinor: 10000, charge: { currency: 'VES', status: ChargeStatus.PAID } };
    const stale = { id: 'stale', paymentId: 'payment', chargeId: 'stale-charge', amount: 100000,
      paymentOriginalAmountMinor: 2740, charge: { currency: 'VES', status: ChargeStatus.PAID } };
    const allocations = [known, stale];
    let paymentStatus = PaymentStatus.RECONCILED;
    const update = jest.fn().mockImplementation(async ({ data }: { data: { status: PaymentStatus } }) => {
      paymentStatus = data.status;
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      paymentAllocation: {
        findFirst: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
          const allocation = allocations.find((item) => item.id === where.id);
          return allocation && (where.payment === undefined
            ? { paymentId: allocation.paymentId, chargeId: allocation.chargeId }
            : { id: allocation.id, paymentId: allocation.paymentId, chargeId: allocation.chargeId,
                amount: allocation.amount });
        }),
        deleteMany: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
          const index = allocations.findIndex((item) => item.id === where.id);
          if (index < 0) return { count: 0 };
          allocations.splice(index, 1);
          return { count: 1 };
        }),
      },
      charge: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'stale-charge', amount: 100000, status: ChargeStatus.PAID, paymentAllocations: [],
        }),
        update: jest.fn(),
      },
      payment: {
        findUnique: jest.fn().mockImplementation(async () => ({
          id: 'payment', amount: 10000, currency: 'USD', status: paymentStatus, ...completeSnapshot,
          paymentAllocations: allocations,
        })),
        update,
      },
    } as unknown as Prisma.TransactionClient;

    await deleteLockedAllocation(tx, 'tenant', 'building', 'stale');
    expect(allocations).toHaveLength(1);
    expect(paymentStatus).toBe(PaymentStatus.RECONCILED);
    expect(aggregatePaymentSideAllocations({
      id: 'payment', amount: 10000, currency: 'USD', ...completeSnapshot,
      paymentAllocations: allocations,
    })).toMatchObject({ mode: 'CROSS', originalRemainingMinor: 0, functionalRemainingMinor: 0 });
  });

  it.each([
    { label: 'LEGACY_NULL', snapshot: {
      functionalAmountMinor: null, functionalCurrencyCode: null, exchangeRateId: null,
      exchangeRateValue: null, exchangeRateDirection: null, exchangeRateEffectiveAt: null,
      conversionDate: null,
    }, error: 'PAYMENT_LEGACY_SNAPSHOT_REQUIRED' },
    { label: 'PARTIAL_INVALID', snapshot: { ...completeSnapshot, exchangeRateId: null },
      error: 'PAYMENT_FUNCTIONAL_SNAPSHOT_INVALID' },
  ])('strict aggregation still fails closed for CROSS with $label snapshot', async ({ snapshot, error }) => {
    expect(() => aggregatePaymentSideAllocations({
      id: 'payment', amount: 10000, currency: 'USD', ...snapshot,
      paymentAllocations: [{ amount: 100000, paymentOriginalAmountMinor: 2740, charge: { currency: 'VES' } }],
    })).toThrow(expect.objectContaining({ response: { statusCode: 422, error } }));
  });
});
