import { PaymentStatus } from '@prisma/client';
import { AssistantDebtCalculatorService } from './assistant-debt-calculator.service';

describe('AssistantDebtCalculatorService', () => {
  let service: AssistantDebtCalculatorService;

  beforeEach(() => {
    service = new AssistantDebtCalculatorService();
  });

  it('returns full charge amount when there are no allocations', () => {
    expect(service.calculateOutstanding([{ amount: 10000, paymentAllocations: [] }])).toBe(10000);
  });

  it('subtracts APPROVED allocations', () => {
    expect(service.calculateOutstanding([
      { amount: 10000, paymentAllocations: [{ amount: 2500, payment: { status: PaymentStatus.APPROVED } }] },
    ])).toBe(7500);
  });

  it('subtracts RECONCILED allocations', () => {
    expect(service.calculateOutstanding([
      { amount: 10000, paymentAllocations: [{ amount: 4000, payment: { status: PaymentStatus.RECONCILED } }] },
    ])).toBe(6000);
  });

  it('ignores submitted, pending and rejected allocations', () => {
    expect(service.calculateOutstanding([
      {
        amount: 10000,
        paymentAllocations: [
          { amount: 1000, payment: { status: PaymentStatus.SUBMITTED } },
          { amount: 2000, payment: { status: PaymentStatus.PENDING } },
          { amount: 3000, payment: { status: PaymentStatus.REJECTED } },
        ],
      },
    ])).toBe(10000);
  });

  it('never returns negative debt on over-allocation', () => {
    expect(service.calculateOutstanding([
      { amount: 10000, paymentAllocations: [{ amount: 15000, payment: { status: PaymentStatus.APPROVED } }] },
    ])).toBe(0);
  });

  it('aggregates outstanding debt by unit', () => {
    const result = service.calculateOutstandingByUnit([
      { unitId: 'unit-1', amount: 10000, paymentAllocations: [{ amount: 2500, payment: { status: PaymentStatus.APPROVED } }] },
      { unitId: 'unit-1', amount: 5000, paymentAllocations: [] },
      { unitId: 'unit-2', amount: 7000, paymentAllocations: [{ amount: 2000, payment: { status: PaymentStatus.RECONCILED } }] },
    ]);

    expect(result.get('unit-1')).toBe(12500);
    expect(result.get('unit-2')).toBe(5000);
  });
});
