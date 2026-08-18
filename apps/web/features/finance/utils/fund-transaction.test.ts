import { isFundTransactionReversible } from './fund-transaction';

describe('isFundTransactionReversible', () => {
  const base = {
    id: 'tx-manual',
    incomeApplicationId: null,
    reversalOfTransactionId: null,
  };

  it('allows an untouched manual transaction', () => {
    expect(isFundTransactionReversible(base, [])).toBe(true);
  });

  it('blocks a transaction owned by an IncomeApplication', () => {
    expect(isFundTransactionReversible(
      { ...base, incomeApplicationId: 'app-1' },
      [],
    )).toBe(false);
  });

  it('blocks a transaction that is itself a reversal row', () => {
    expect(isFundTransactionReversible(
      { ...base, reversalOfTransactionId: 'tx-original' },
      [],
    )).toBe(false);
  });

  it('blocks an already-reversed original', () => {
    const transactions = [
      base,
      { id: 'tx-reversal', incomeApplicationId: null, reversalOfTransactionId: 'tx-manual' },
    ];
    expect(isFundTransactionReversible(base, transactions)).toBe(false);
  });
});
