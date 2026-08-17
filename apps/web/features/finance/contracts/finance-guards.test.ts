import {
  isFundTransaction,
  isIncomeApplication,
  isIncomeOffsetSnapshotItem,
  isIncomePolicy,
  isLiquidationV3Summary,
  parseLegacyBackfillPreview,
  parseLegacyBackfillResults,
} from './finance-guards';
import { CANONICAL_CURRENCIES, isFinanceCurrency } from './currencies';
import { CANONICAL_CURRENCIES as SHARED_CANONICAL_CURRENCIES } from '@buildingos/contracts';

const application = {
  id: 'app-1', tenantId: 'tenant-1', incomeId: 'income-1', destinationType: 'OFFSET_EXPENSES',
  fundId: null, amountMinor: 1, currencyCode: 'COP', fundTransactionId: null,
  policyVersionId: null, legacyDestination: null, createdAt: '2026-08-01T00:00:00.000Z',
};

describe('FIN-07AR finance guards', () => {
  it('rejects zero financial transaction and application amounts', () => {
    expect(isFundTransaction({ id: 'tx', tenantId: 't', fundId: 'f', direction: 'CREDIT', amountMinor: 0, currencyCode: 'COP' })).toBe(false);
    expect(isIncomeApplication({ ...application, amountMinor: 0 })).toBe(false);
    expect(isIncomeApplication({ ...application, destinationType: 'FUND', fundId: null })).toBe(false);
  });

  it('rejects malformed policy versions and basis points', () => {
    const policy = { id: 'policy', tenantId: 'tenant', categoryId: 'category', currentVersion: null, versions: [{ id: 'version', version: 1, status: 'ACTIVE', createdAt: '2026-08-01', rules: [{ destinationType: 'FUND', fundId: 'fund', percentageBasisPoints: 10000 }] }] };
    expect(isIncomePolicy({ ...policy, currentVersion: { version: 0 } })).toBe(false);
    expect(isIncomePolicy({ ...policy, versions: [{ ...policy.versions[0], version: 0 }] })).toBe(false);
    expect(isIncomePolicy({ ...policy, versions: [{ ...policy.versions[0], status: 'UNKNOWN' }] })).toBe(false);
    expect(isIncomePolicy({ ...policy, versions: [{ ...policy.versions[0], rules: [{ destinationType: 'FUND', fundId: 'fund', percentageBasisPoints: '1' }] }] })).toBe(false);
  });

  it('rejects unknown legacy classifications and result statuses', () => {
    const preview = { incomeId: 'income', period: '2026-08', categoryId: 'cat', scopeType: 'BUILDING', buildingId: 'building', status: 'RECORDED', destination: 'APPLY_TO_EXPENSES', amountMinor: 1, currencyCode: 'USD', applicationsCount: 0, classification: 'UNKNOWN' };
    expect(() => parseLegacyBackfillPreview([preview])).toThrow('Invalid legacy backfill preview response');
    expect(() => parseLegacyBackfillResults([{ incomeId: 'income', status: 'UNKNOWN' }])).toThrow('Invalid legacy backfill results response');
  });

  it('requires all-or-none V3 summaries and exact safe equations', () => {
    expect(isLiquidationV3Summary({})).toBe(true);
    expect(isLiquidationV3Summary({ grossExpenseAmountMinor: null, adjustmentAmountMinor: null, preIncomeAmountMinor: null, incomeOffsetAmountMinor: null, netDistributableAmountMinor: null })).toBe(true);
    expect(isLiquidationV3Summary({ grossExpenseAmountMinor: 10000, adjustmentAmountMinor: 0, preIncomeAmountMinor: 10000, incomeOffsetAmountMinor: 3000, netDistributableAmountMinor: 7000 })).toBe(true);
    expect(isLiquidationV3Summary({ grossExpenseAmountMinor: 10000 })).toBe(false);
    expect(isLiquidationV3Summary({ grossExpenseAmountMinor: 10000, adjustmentAmountMinor: 0, preIncomeAmountMinor: 10000, incomeOffsetAmountMinor: 3000, netDistributableAmountMinor: 6000 })).toBe(false);
    expect(isLiquidationV3Summary({ grossExpenseAmountMinor: Number.MAX_SAFE_INTEGER, adjustmentAmountMinor: 1, preIncomeAmountMinor: Number.MAX_SAFE_INTEGER, incomeOffsetAmountMinor: 0, netDistributableAmountMinor: Number.MAX_SAFE_INTEGER })).toBe(false);
  });

  it('validates the FIN-07C offset snapshot foundation completely', () => {
    expect(isIncomeOffsetSnapshotItem({ incomeId: 'income', incomeApplicationId: 'app', categoryId: 'cat', categoryName: null, policyVersionId: null, legacyDestination: 'APPLY_TO_EXPENSES', scopeType: 'BUILDING', currencyCode: 'USD', applicationAmountMinor: 1, buildingAmountMinor: 1, valuedAmountMinor: 1, functionalCurrencyCode: null, exchangeRateId: null, exchangeRateValue: null, exchangeRateDirection: null, exchangeRateEffectiveAt: null, conversionDate: null, receivedDate: '2026-08-01', period: '2026-08' })).toBe(true);
  });

  it('uses shared canonical currencies instead of a local list', () => {
    expect(CANONICAL_CURRENCIES).toBe(SHARED_CANONICAL_CURRENCIES);
    expect(isFinanceCurrency('COP')).toBe(true);
    expect(isFinanceCurrency('USD')).toBe(true);
    expect(isFinanceCurrency('VES')).toBe(true);
    expect(isFinanceCurrency('ARS')).toBe(true);
  });
});
