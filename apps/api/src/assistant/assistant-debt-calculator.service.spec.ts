import { ChargeStatus, PaymentStatus } from '@prisma/client';
import { AssistantDebtCalculatorService } from './assistant-debt-calculator.service';

describe('AssistantDebtCalculatorService', () => {
  let service: AssistantDebtCalculatorService;

  beforeEach(() => {
    service = new AssistantDebtCalculatorService();
  });

  it('returns full PENDING charge amount when there are no allocations', () => {
    expect(
      service.calculateChargeOutstanding({
        amount: 10000,
        currency: 'ARS',
        status: ChargeStatus.PENDING,
        paymentAllocations: [],
      }),
    ).toBe(10000);
  });

  it('returns full PARTIAL charge amount before allocation subtraction', () => {
    expect(
      service.calculateChargeOutstanding({
        amount: 10000,
        currency: 'ARS',
        status: ChargeStatus.PARTIAL,
        paymentAllocations: [{ amount: 2500, payment: { status: PaymentStatus.APPROVED, canceledAt: null } }],
      }),
    ).toBe(7500);
  });

  it('returns zero for PAID and CANCELED charges despite missing allocations', () => {
    expect(
      service.calculateChargeOutstanding({
        amount: 10000,
        currency: 'ARS',
        status: ChargeStatus.PAID,
        paymentAllocations: [],
      }),
    ).toBe(0);
    expect(
      service.calculateChargeOutstanding({
        amount: 10000,
        currency: 'ARS',
        status: ChargeStatus.CANCELED,
        paymentAllocations: [],
      }),
    ).toBe(0);
  });

  it('subtracts APPROVED allocations', () => {
    expect(
      service.calculateChargeOutstanding({
        amount: 10000,
        currency: 'ARS',
        status: ChargeStatus.PENDING,
        paymentAllocations: [{ amount: 2500, payment: { status: PaymentStatus.APPROVED, canceledAt: null } }],
      }),
    ).toBe(7500);
  });

  it('subtracts RECONCILED allocations', () => {
    expect(
      service.calculateChargeOutstanding({
        amount: 10000,
        currency: 'ARS',
        status: ChargeStatus.PARTIAL,
        paymentAllocations: [{ amount: 4000, payment: { status: PaymentStatus.RECONCILED, canceledAt: null } }],
      }),
    ).toBe(6000);
  });

  it('ignores submitted, pending and rejected allocations', () => {
    expect(
      service.calculateChargeOutstanding({
        amount: 10000,
        currency: 'ARS',
        status: ChargeStatus.PENDING,
        paymentAllocations: [
          { amount: 1000, payment: { status: PaymentStatus.SUBMITTED, canceledAt: null } },
          { amount: 2000, payment: { status: PaymentStatus.PENDING, canceledAt: null } },
          { amount: 3000, payment: { status: PaymentStatus.REJECTED, canceledAt: null } },
        ],
      }),
    ).toBe(10000);
  });

  it('ignores APPROVED and RECONCILED allocations from soft-canceled payments', () => {
    expect(
      service.calculateChargeOutstanding({
        amount: 10000,
        currency: 'ARS',
        status: ChargeStatus.PENDING,
        paymentAllocations: [
          { amount: 3000, payment: { status: PaymentStatus.APPROVED, canceledAt: new Date('2026-01-01') } },
          { amount: 4000, payment: { status: PaymentStatus.RECONCILED, canceledAt: '2026-01-02T00:00:00.000Z' } },
        ],
      }),
    ).toBe(10000);
  });

  it('applies active APPROVED and RECONCILED allocations', () => {
    expect(
      service.calculateChargeOutstanding({
        amount: 10000,
        currency: 'ARS',
        status: ChargeStatus.PARTIAL,
        paymentAllocations: [
          { amount: 3000, payment: { status: PaymentStatus.APPROVED, canceledAt: null } },
          { amount: 4000, payment: { status: PaymentStatus.RECONCILED, canceledAt: null } },
        ],
      }),
    ).toBe(3000);
  });

  it('never returns negative debt on over-allocation', () => {
    expect(
      service.calculateChargeOutstanding({
        amount: 10000,
        currency: 'ARS',
        status: ChargeStatus.PARTIAL,
        paymentAllocations: [{ amount: 15000, payment: { status: PaymentStatus.APPROVED, canceledAt: null } }],
      }),
    ).toBe(0);
  });

  it('aggregates only eligible charge statuses into independent currency buckets', () => {
    const result = service.calculateOutstandingByCurrency([
      { amount: 10000, currency: 'ARS', status: ChargeStatus.PENDING, paymentAllocations: [] },
      { amount: 5000, currency: 'USD', status: ChargeStatus.PARTIAL, paymentAllocations: [] },
      { amount: 2000, currency: 'ARS', status: ChargeStatus.PAID, paymentAllocations: [] },
      { amount: 3000, currency: 'USD', status: ChargeStatus.CANCELED, paymentAllocations: [] },
    ]);

    expect(result).toEqual([
      { currency: 'USD', amountMinor: 5000 },
      { currency: 'ARS', amountMinor: 10000 },
    ]);
  });

  it('aggregates outstanding per unit with per-currency buckets', () => {
    const result = service.calculateOutstandingByUnit([
      {
        unitId: 'unit-1',
        amount: 10000,
        currency: 'ARS',
        status: ChargeStatus.PARTIAL,
        paymentAllocations: [{ amount: 2500, payment: { status: PaymentStatus.APPROVED, canceledAt: null } }],
      },
      { unitId: 'unit-1', amount: 5000, currency: 'USD', status: ChargeStatus.PENDING, paymentAllocations: [] },
      { unitId: 'unit-2', amount: 7000, currency: 'ARS', status: ChargeStatus.PENDING, paymentAllocations: [] },
      { unitId: 'unit-3', amount: 9000, currency: 'VES', status: ChargeStatus.PAID, paymentAllocations: [] },
    ]);

    expect(result.get('unit-1')).toEqual([
      { currency: 'USD', amountMinor: 5000 },
      { currency: 'ARS', amountMinor: 7500 },
    ]);
    expect(result.get('unit-2')).toEqual([{ currency: 'ARS', amountMinor: 7000 }]);
    expect(result.has('unit-3')).toBe(false);
  });

  it('drops eligible charges without a currency instead of inventing one', () => {
    const result = service.calculateOutstandingByCurrency([
      { amount: 10000, status: ChargeStatus.PENDING, paymentAllocations: [] },
    ]);

    expect(result).toEqual([]);
  });
});
