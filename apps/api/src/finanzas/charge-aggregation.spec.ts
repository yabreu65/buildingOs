import {
  calculateChargeOutstandingMinor,
  sumByCurrency,
} from './charge-aggregation';
import { ChargeStatus, PaymentStatus } from '@prisma/client';

describe('calculateChargeOutstandingMinor', () => {
  const effectiveApproved = { payment: { status: PaymentStatus.APPROVED } };
  const effectiveReconciled = { payment: { status: PaymentStatus.RECONCILED } };
  const submitted = { payment: { status: PaymentStatus.SUBMITTED } };
  const rejected = { payment: { status: PaymentStatus.REJECTED } };

  function charge(amount: number, allocations: Array<{ amount: number; payment?: { status?: string | null } | null }> = []) {
    return { amount, paymentAllocations: allocations };
  }

  it('A: no allocations -> full amount', () => {
    expect(calculateChargeOutstandingMinor(charge(10000))).toBe(10000);
  });

  it('B: APPROVED allocation 4000 of 10000 -> 6000', () => {
    expect(
      calculateChargeOutstandingMinor(charge(10000, [{ amount: 4000, ...effectiveApproved }])),
    ).toBe(6000);
  });

  it('C: RECONCILED allocation 10000 of 10000 -> 0', () => {
    expect(
      calculateChargeOutstandingMinor(charge(10000, [{ amount: 10000, ...effectiveReconciled }])),
    ).toBe(0);
  });

  it('D: SUBMITTED allocation 7000 of 10000 -> accounting outstanding 10000', () => {
    expect(
      calculateChargeOutstandingMinor(charge(10000, [{ amount: 7000, ...submitted }])),
    ).toBe(10000);
  });

  it('E: APPROVED 3000 + SUBMITTED 7000 of 10000 -> 7000', () => {
    expect(
      calculateChargeOutstandingMinor(
        charge(10000, [
          { amount: 3000, ...effectiveApproved },
          { amount: 7000, ...submitted },
        ]),
      ),
    ).toBe(7000);
  });

  it('F: CROSS charge-side (allocation in Charge.currency only) -> 0, never mixes Payment original', () => {
    // Charge 182500 ARS, allocation.amount = 182500 ARS (Charge.currency),
    // paymentOriginalAmountMinor = 5000 USD is NOT part of the input.
    expect(
      calculateChargeOutstandingMinor(
        charge(182500, [{ amount: 182500, ...effectiveApproved }]),
      ),
    ).toBe(0);
  });

  it('G: REJECTED allocation does not reduce outstanding', () => {
    expect(
      calculateChargeOutstandingMinor(charge(10000, [{ amount: 10000, ...rejected }])),
    ).toBe(10000);
  });

  it('allocation without payment relation is ignored', () => {
    expect(calculateChargeOutstandingMinor(charge(10000, [{ amount: 5000 }]))).toBe(10000);
  });

  it('null payment status is ignored', () => {
    expect(
      calculateChargeOutstandingMinor(charge(10000, [{ amount: 5000, payment: { status: null } }])),
    ).toBe(10000);
  });

  it('mixed effective and non-effective statuses', () => {
    expect(
      calculateChargeOutstandingMinor(
        charge(10000, [
          { amount: 3000, ...effectiveApproved },
          { amount: 2000, ...effectiveReconciled },
          { amount: 4000, ...submitted },
          { amount: 1000, ...rejected },
        ]),
      ),
    ).toBe(5000);
  });

  it('over-allocated charge clamps to 0 (never negative)', () => {
    expect(
      calculateChargeOutstandingMinor(charge(10000, [{ amount: 15000, ...effectiveApproved }])),
    ).toBe(0);
  });

  it('zero-amount charge stays 0', () => {
    expect(calculateChargeOutstandingMinor(charge(0))).toBe(0);
    expect(
      calculateChargeOutstandingMinor(charge(0, [{ amount: 0, ...effectiveApproved }])),
    ).toBe(0);
  });

  it('empty/null paymentAllocations treated as no allocations', () => {
    expect(calculateChargeOutstandingMinor({ amount: 5000, paymentAllocations: null })).toBe(5000);
    expect(calculateChargeOutstandingMinor({ amount: 5000, paymentAllocations: undefined })).toBe(5000);
  });

  it('does not use paymentOriginalAmountMinor or Payment.amount (not part of input contract)', () => {
    // The input contract has no original-side fields; this is a compile-time
    // guarantee via the ChargeOutstandingInput interface. Behavior is proven
    // by CROSS test F above.
    expect(calculateChargeOutstandingMinor(charge(10000, []))).toBe(10000);
  });

  it('ChargeStatus of the charge itself does not alter outstanding (derived from allocations)', () => {
    // Outstanding is computed from amount minus effective allocations
    // regardless of the charge.status column.
    expect(
      calculateChargeOutstandingMinor(charge(10000, [{ amount: 4000, ...effectiveApproved }])),
    ).toBe(6000);
    void ChargeStatus; // imported enum documented as not used by the helper
  });
});

describe('sumByCurrency', () => {
  it('single currency ARS', () => {
    expect(
      sumByCurrency([
        { currency: 'ARS', amountMinor: 100 },
        { currency: 'ARS', amountMinor: 200 },
      ]),
    ).toEqual([{ currency: 'ARS', amountMinor: 300 }]);
  });

  it('single currency USD', () => {
    expect(sumByCurrency([{ currency: 'USD', amountMinor: 500 }])).toEqual([
      { currency: 'USD', amountMinor: 500 },
    ]);
  });

  it('single currency VES', () => {
    expect(sumByCurrency([{ currency: 'VES', amountMinor: 700 }])).toEqual([
      { currency: 'VES', amountMinor: 700 },
    ]);
  });

  it('single currency COP', () => {
    expect(sumByCurrency([{ currency: 'COP', amountMinor: 900 }])).toEqual([
      { currency: 'COP', amountMinor: 900 },
    ]);
  });

  it('ARS + USD stays separate', () => {
    expect(
      sumByCurrency([
        { currency: 'ARS', amountMinor: 1000 },
        { currency: 'USD', amountMinor: 2000 },
      ]),
    ).toEqual([
      { currency: 'USD', amountMinor: 2000 },
      { currency: 'ARS', amountMinor: 1000 },
    ]);
  });

  it('all four canonical currencies stay separate', () => {
    expect(
      sumByCurrency([
        { currency: 'USD', amountMinor: 1 },
        { currency: 'VES', amountMinor: 2 },
        { currency: 'COP', amountMinor: 3 },
        { currency: 'ARS', amountMinor: 4 },
      ]),
    ).toEqual([
      { currency: 'USD', amountMinor: 1 },
      { currency: 'VES', amountMinor: 2 },
      { currency: 'ARS', amountMinor: 4 },
      { currency: 'COP', amountMinor: 3 },
    ]);
  });

  it('input order does not change the result', () => {
    const a = [
      { currency: 'USD', amountMinor: 10 },
      { currency: 'ARS', amountMinor: 20 },
      { currency: 'USD', amountMinor: 30 },
    ];
    const b = [
      { currency: 'USD', amountMinor: 30 },
      { currency: 'USD', amountMinor: 10 },
      { currency: 'ARS', amountMinor: 20 },
    ];
    expect(sumByCurrency(a)).toEqual(sumByCurrency(b));
  });

  it('zero amounts are preserved per currency', () => {
    expect(sumByCurrency([{ currency: 'ARS', amountMinor: 0 }])).toEqual([
      { currency: 'ARS', amountMinor: 0 },
    ]);
  });

  it('empty input -> empty buckets', () => {
    expect(sumByCurrency([])).toEqual([]);
  });

  it('unsupported currency fails fast (no unlabeled total)', () => {
    expect(() =>
      sumByCurrency([{ currency: 'UYU', amountMinor: 100 }]),
    ).toThrow('unsupported currency "UYU"');
  });

  it('missing currency fails fast', () => {
    expect(() =>
      sumByCurrency([{ currency: '', amountMinor: 100 }]),
    ).toThrow('unsupported currency ""');
  });
});
