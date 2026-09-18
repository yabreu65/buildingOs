import {
  classifyFinanceCondition,
  FinanceCondition,
} from './classifier';

function condition(overrides: Partial<FinanceCondition> = {}): FinanceCondition {
  return {
    entity: 'liquidations',
    counterpartPresent: true,
    sameTenant: true,
    currencyCompatible: true,
    currencySupported: true,
    invariantValid: true,
    representation: 'CURRENT',
    ...overrides,
  };
}

describe('historical finance classification precedence', () => {
  it('classifies supported current and recognized legacy representations', () => {
    expect(classifyFinanceCondition(condition())).toEqual({ classification: 'SAFE', category: 'CURRENT_SUPPORTED' });
    expect(classifyFinanceCondition(condition({ representation: 'V1' }))).toEqual({ classification: 'LEGACY_SUPPORTED', category: 'SUPPORTED_LEGACY' });
    expect(classifyFinanceCondition(condition({ entity: 'incomes', representation: 'LEGACY_INCOME' }))).toEqual({ classification: 'LEGACY_SUPPORTED', category: 'SUPPORTED_LEGACY' });
    expect(classifyFinanceCondition(condition({ entity: 'incomes', representation: 'LEGACY_INCOME_REQUIRES_FUND' }))).toEqual({ classification: 'LEGACY_SUPPORTED', category: 'SUPPORTED_LEGACY' });
    expect(classifyFinanceCondition(condition({ entity: 'incomes', representation: 'LEGACY_INCOME_LIQUIDATION_CONFLICT' }))).toEqual({ classification: 'LEGACY_SUPPORTED', category: 'SUPPORTED_LEGACY' });
    expect(classifyFinanceCondition(condition({ entity: 'paymentAllocations', representation: 'LEGACY_PAYMENT_ALLOCATION_CROSS' }))).toEqual({ classification: 'LEGACY_SUPPORTED', category: 'SUPPORTED_LEGACY' });
    expect(classifyFinanceCondition(condition({ representation: 'V3' }))).toEqual({ classification: 'SAFE', category: 'CURRENT_SUPPORTED' });
    expect(classifyFinanceCondition(condition({ representation: 'ZERO_NET' }))).toEqual({ classification: 'SAFE', category: 'CURRENT_SUPPORTED' });
  });

  it('classifies non-blocking unknown history as repairable', () => {
    expect(classifyFinanceCondition(condition({ representation: 'V9' }))).toEqual({ classification: 'REPAIRABLE', category: 'UNSUPPORTED_VARIANT' });
    expect(classifyFinanceCondition(condition({ entity: 'incomes', representation: 'V9' }))).toEqual({ classification: 'REPAIRABLE', category: 'UNSUPPORTED_VARIANT' });
  });

  it.each([
    ['missing relationship', { counterpartPresent: false }, 'MISSING_COUNTERPART'],
    ['cross-tenant relationship', { sameTenant: false }, 'CROSS_TENANT'],
    ['currency violation', { currencyCompatible: false }, 'CURRENCY_INVALID'],
    ['unsupported currency', { currencySupported: false }, 'CURRENCY_INVALID'],
    ['invariant violation', { invariantValid: false }, 'INVARIANT_VIOLATION'],
  ])('classifies %s as blocking', (_name, overrides, category) => {
    expect(classifyFinanceCondition(condition(overrides))).toEqual({ classification: 'INVALID_BLOCKING', category });
  });

  it('does not downgrade a legacy shape with a blocking defect', () => {
    expect(classifyFinanceCondition(condition({ entity: 'incomes', representation: 'LEGACY_INCOME_LIQUIDATION_CONFLICT', sameTenant: false }))).toEqual({ classification: 'INVALID_BLOCKING', category: 'CROSS_TENANT' });
  });
});
