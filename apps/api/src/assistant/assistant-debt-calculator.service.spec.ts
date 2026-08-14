import { PaymentStatus } from '@prisma/client';
import { AssistantDebtCalculatorService } from './assistant-debt-calculator.service';

describe('AssistantDebtCalculatorService', () => {
  let service: AssistantDebtCalculatorService;

  beforeEach(() => {
    service = new AssistantDebtCalculatorService();
  });

  it('returns full charge amount when there are no allocations', () => {
    expect(
      service.calculateChargeOutstanding({
        amount: 10000,
        currency: 'ARS',
        paymentAllocations: [],
      }),
    ).toBe(10000);
  });

  it('subtracts APPROVED allocations', () => {
    expect(
      service.calculateChargeOutstanding({
        amount: 10000,
        currency: 'ARS',
        paymentAllocations: [{ amount: 2500, payment: { status: PaymentStatus.APPROVED } }],
      }),
    ).toBe(7500);
  });

  it('subtracts RECONCILED allocations', () => {
    expect(
      service.calculateChargeOutstanding({
        amount: 10000,
        currency: 'ARS',
        paymentAllocations: [{ amount: 4000, payment: { status: PaymentStatus.RECONCILED } }],
      }),
    ).toBe(6000);
  });

  it('ignores submitted, pending and rejected allocations', () => {
    expect(
      service.calculateChargeOutstanding({
        amount: 10000,
        currency: 'ARS',
        paymentAllocations: [
          { amount: 1000, payment: { status: PaymentStatus.SUBMITTED } },
          { amount: 2000, payment: { status: PaymentStatus.PENDING } },
          { amount: 3000, payment: { status: PaymentStatus.REJECTED } },
        ],
      }),
    ).toBe(10000);
  });

  it('never returns negative debt on over-allocation', () => {
    expect(
      service.calculateChargeOutstanding({
        amount: 10000,
        currency: 'ARS',
        paymentAllocations: [{ amount: 15000, payment: { status: PaymentStatus.APPROVED } }],
      }),
    ).toBe(0);
  });

  it('aggregates outstanding by currency buckets — never a mixed scalar', () => {
    const result = service.calculateOutstandingByCurrency([
      { amount: 10000, currency: 'ARS', paymentAllocations: [] },
      { amount: 5000, currency: 'USD', paymentAllocations: [] },
      { amount: 2000, currency: 'ARS', paymentAllocations: [{ amount: 2000, payment: { status: PaymentStatus.APPROVED } }] },
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
        paymentAllocations: [{ amount: 2500, payment: { status: PaymentStatus.APPROVED } }],
      },
      { unitId: 'unit-1', amount: 5000, currency: 'USD', paymentAllocations: [] },
      { unitId: 'unit-2', amount: 7000, currency: 'ARS', paymentAllocations: [] },
      { unitId: 'unit-3', amount: 9000, currency: 'VES', paymentAllocations: [{ amount: 9000, payment: { status: PaymentStatus.APPROVED } }] },
    ]);

    expect(result.get('unit-1')).toEqual([
      { currency: 'USD', amountMinor: 5000 },
      { currency: 'ARS', amountMinor: 7500 },
    ]);
    expect(result.get('unit-2')).toEqual([{ currency: 'ARS', amountMinor: 7000 }]);
    // Fully paid unit has no entry.
    expect(result.has('unit-3')).toBe(false);
  });

  it('drops charges without a currency instead of inventing one', () => {
    const result = service.calculateOutstandingByCurrency([
      { amount: 10000, paymentAllocations: [] },
    ]);

    expect(result).toEqual([]);
  });
});
