import { FinanceCurrencyStatus, FinanceInventoryEntity } from './contracts';

export const FINANCE_CLASSIFICATIONS = [
  'SAFE',
  'LEGACY_SUPPORTED',
  'REPAIRABLE',
  'INVALID_BLOCKING',
] as const;

export type FinanceClassification = (typeof FINANCE_CLASSIFICATIONS)[number];

export type FinanceFindingCategory =
  | 'CURRENT_SUPPORTED'
  | 'SUPPORTED_LEGACY'
  | 'UNSUPPORTED_VARIANT'
  | 'MISSING_COUNTERPART'
  | 'CROSS_TENANT'
  | 'CURRENCY_INVALID'
  | 'MALFORMED_CURRENCY'
  | 'INVARIANT_VIOLATION';

export interface FinanceCondition {
  readonly entity: FinanceInventoryEntity;
  readonly counterpartPresent: boolean;
  readonly sameTenant: boolean;
  readonly currencyCompatible: boolean;
  readonly currencyStatuses: readonly FinanceCurrencyStatus[];
  readonly invariantValid: boolean;
  readonly representation?: string;
}

export interface FinanceClassificationDecision {
  readonly classification: FinanceClassification;
  readonly category: FinanceFindingCategory;
}

const LEGACY_REPRESENTATIONS = new Set([
  'V1',
  'V2',
  'LEGACY_INCOME',
  'LEGACY_INCOME_REQUIRES_FUND',
  'LEGACY_INCOME_LIQUIDATION_CONFLICT',
  'LEGACY_PAYMENT_ALLOCATION_CROSS',
]);
const CURRENT_REPRESENTATIONS = new Set(['CURRENT', 'V3', 'ZERO_NET']);

/** Applies the documented invariant-first classification precedence. */
export function classifyFinanceCondition(condition: FinanceCondition): FinanceClassificationDecision {
  if (!condition.counterpartPresent) {
    return { classification: 'INVALID_BLOCKING', category: 'MISSING_COUNTERPART' };
  }
  if (!condition.sameTenant) {
    return { classification: 'INVALID_BLOCKING', category: 'CROSS_TENANT' };
  }
  if (!condition.currencyCompatible) {
    return { classification: 'INVALID_BLOCKING', category: 'CURRENCY_INVALID' };
  }
  if (!condition.invariantValid) {
    return { classification: 'INVALID_BLOCKING', category: 'INVARIANT_VIOLATION' };
  }
  if (condition.currencyStatuses.includes('MALFORMED')) {
    return { classification: 'REPAIRABLE', category: 'MALFORMED_CURRENCY' };
  }
  if (
    condition.currencyStatuses.includes('LEGACY_STORED')
    || (condition.representation !== undefined && LEGACY_REPRESENTATIONS.has(condition.representation))
  ) {
    return { classification: 'LEGACY_SUPPORTED', category: 'SUPPORTED_LEGACY' };
  }

  if (condition.representation !== undefined && !CURRENT_REPRESENTATIONS.has(condition.representation)) {
    return { classification: 'REPAIRABLE', category: 'UNSUPPORTED_VARIANT' };
  }

  return { classification: 'SAFE', category: 'CURRENT_SUPPORTED' };
}
