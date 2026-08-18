import { liquidationHasV3Summary, liquidationIsZeroNet } from './liquidation-v3';

function base() {
  return {
    grossExpenseAmountMinor: 10000,
    adjustmentAmountMinor: 0,
    preIncomeAmountMinor: 10000,
    incomeOffsetAmountMinor: 1500,
    netDistributableAmountMinor: 8500,
  };
}

describe('liquidationHasV3Summary', () => {
  it('is true when all five FIN-06 fields are present', () => {
    expect(liquidationHasV3Summary(base())).toBe(true);
  });

  it('is false for historical V1/V2 (null summary fields)', () => {
    expect(
      liquidationHasV3Summary({
        grossExpenseAmountMinor: null,
        adjustmentAmountMinor: null,
        preIncomeAmountMinor: null,
        incomeOffsetAmountMinor: null,
        netDistributableAmountMinor: null,
      }),
    ).toBe(false);
  });

  it('is false when any field is missing', () => {
    expect(
      liquidationHasV3Summary({ ...base(), netDistributableAmountMinor: null }),
    ).toBe(false);
  });
});

describe('liquidationIsZeroNet', () => {
  it('detects zero net when pre-income equals the offset', () => {
    expect(
      liquidationIsZeroNet({
        grossExpenseAmountMinor: 5000,
        adjustmentAmountMinor: 0,
        preIncomeAmountMinor: 5000,
        incomeOffsetAmountMinor: 5000,
        netDistributableAmountMinor: 0,
      }),
    ).toBe(true);
  });

  it('is false for a normal non-zero net', () => {
    expect(liquidationIsZeroNet(base())).toBe(false);
  });

  it('is false for historical null fields', () => {
    expect(
      liquidationIsZeroNet({
        grossExpenseAmountMinor: null,
        adjustmentAmountMinor: null,
        preIncomeAmountMinor: null,
        incomeOffsetAmountMinor: null,
        netDistributableAmountMinor: null,
      }),
    ).toBe(false);
  });
});
