/**
 * FIN-07A: parsers/type guards runtime para respuestas financieras.
 *
 * Estrategia: fail-closed en contratos críticos (balances, provenance,
 * basis points, V3). No instalar librería de validación: guards simples.
 */

import type {
  Fund,
  FundBalance,
  IncomeApplication,
  IncomeApplicationDestination,
  IncomeDestination,
  IncomeOffsetSnapshotItem,
  IncomePolicyRule,
  IncomePolicy,
  IncomeApplicationPlan,
  FundTransaction,
  LegacyBackfillApplyResultItem,
  LegacyBackfillPreviewItem,
  LiquidationV3Summary,
} from './finance-types';

const DESTINATIONS = new Set(['OFFSET_EXPENSES', 'FUND', 'CARRY_FORWARD']);
const LEGACY_DESTINATIONS = new Set(['APPLY_TO_EXPENSES', 'RESERVE_FUND', 'SPECIAL_FUND']);
const POLICY_STATUSES = new Set(['ACTIVE', 'INACTIVE']);
const INCOME_SCOPES = new Set(['BUILDING', 'TENANT_SHARED', 'UNIT_GROUP']);
const INCOME_STATUSES = new Set(['DRAFT', 'RECORDED', 'VOID']);
const LEGACY_CLASSIFICATIONS = new Set([
  'AUTO_MAPPABLE_OFFSET', 'REQUIRES_RESERVE_FUND', 'REQUIRES_SPECIAL_FUND',
  'ALREADY_HAS_PLAN', 'NOT_RECORDED', 'LIQUIDATION_CONFLICT',
]);
const LEGACY_RESULT_STATUSES = new Set([
  'MIGRATED', 'ALREADY_MIGRATED', 'ALREADY_HAS_PLAN', 'REQUIRES_FUND',
  'INVALID_FUND', 'LIQUIDATION_CONFLICT', 'NOT_RECORDED', 'NOT_FOUND', 'INVALID_INCOME',
]);

export function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isPositiveSafeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function isDestination(value: unknown): value is IncomeApplicationDestination {
  return typeof value === 'string' && DESTINATIONS.has(value);
}

export function isLegacyDestination(value: unknown): value is IncomeDestination {
  return typeof value === 'string' && LEGACY_DESTINATIONS.has(value);
}

/**
 * Fund balances: multi-moneda, fail-closed. Nunca colapsar a un número.
 */
export function isFundBalance(value: unknown): value is FundBalance {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    isNonEmptyString((value as FundBalance).currency) &&
    isNonNegativeInt((value as FundBalance).amountMinor)
  );
}

export function isFund(value: unknown): value is Fund {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fund = value as Record<string, unknown>;
  if (!isNonEmptyString(fund.id) || !isNonEmptyString(fund.tenantId)) {
    return false;
  }
  if (
    !isNonEmptyString(fund.name) || !isNullableString(fund.buildingId) || !isNullableString(fund.description) ||
    !['TENANT', 'BUILDING'].includes(String(fund.scopeType)) ||
    !['RESERVE', 'SPECIAL', 'OTHER'].includes(String(fund.type)) ||
    !['ACTIVE', 'ARCHIVED'].includes(String(fund.status))
  ) {
    return false;
  }
  if (!Array.isArray(fund.balancesByCurrency)) {
    return false;
  }
  if (!isNonEmptyString(fund.createdAt) || !isNullableString(fund.archivedAt)) return false;
  if (fund.scopeType === 'TENANT' && fund.buildingId !== null) return false;
  if (fund.scopeType === 'BUILDING' && !isNonEmptyString(fund.buildingId)) return false;
  // Fail-closed: cada balance debe ser válido; un balance inválido invalida el Fund.
  return fund.balancesByCurrency.every(isFundBalance);
}

export function isFundTransaction(value: unknown): value is FundTransaction {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const transaction = value as Record<string, unknown>;
  return (
    isNonEmptyString(transaction.id) &&
    isNonEmptyString(transaction.tenantId) &&
    isNonEmptyString(transaction.fundId) &&
    ['CREDIT', 'DEBIT'].includes(String(transaction.direction)) &&
    isNonEmptyString(transaction.currencyCode) &&
    isPositiveSafeInt(transaction.amountMinor) &&
    isNonEmptyString(transaction.occurredAt) &&
    isNullableString(transaction.description) &&
    isNullableString(transaction.idempotencyKey) &&
    isNullableString(transaction.reversalOfTransactionId) &&
    isNonEmptyString(transaction.createdAt)
  );
}

/**
 * IncomeApplication: destination válido; provenance coherente
 * (policy y legacy mutuamente excluyentes).
 */
export function isIncomeApplication(value: unknown): value is IncomeApplication {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const app = value as Record<string, unknown>;
  if (
    !isNonEmptyString(app.id) ||
    !isNonEmptyString(app.tenantId) ||
    !isNonEmptyString(app.incomeId) ||
    !isNonEmptyString(app.currencyCode) ||
    !isNonEmptyString(app.createdAt)
  ) {
    return false;
  }
  if (!isDestination(app.destinationType)) {
    return false;
  }
  if (!isPositiveSafeInt(app.amountMinor) || !isNullableString(app.fundId) || !isNullableString(app.fundTransactionId)) {
    return false;
  }
  const policyVersionId = app.policyVersionId;
  const legacyDestination = app.legacyDestination;
  if (!isNullableString(policyVersionId)) {
    return false;
  }
  if (
    legacyDestination !== null && !isLegacyDestination(legacyDestination)
  ) {
    return false;
  }
  // Mutuamente excluyentes (espejo del CHECK DB).
  if (policyVersionId != null && legacyDestination != null) {
    return false;
  }
  if (app.destinationType === 'FUND' && !isNonEmptyString(app.fundId)) return false;
  if (app.destinationType !== 'FUND' && app.fundId !== null) return false;
  return true;
}

/**
 * Policy rule: percentageBasisPoints entero (10000 = 100%).
 * Rechaza floats o strings.
 */
export function isIncomePolicyRule(value: unknown): value is IncomePolicyRule {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const rule = value as Record<string, unknown>;
  if (!isNonEmptyString(rule.id) || !isDestination(rule.destinationType) || !isNullableString(rule.fundId)) {
    return false;
  }
  return (
    typeof rule.percentageBasisPoints === 'number' &&
    Number.isSafeInteger(rule.percentageBasisPoints) &&
    (rule.percentageBasisPoints as number) >= 1 &&
    (rule.percentageBasisPoints as number) <= 10000 &&
    (rule.destinationType === 'FUND' ? isNonEmptyString(rule.fundId) : rule.fundId === null)
  );
}

function hasFullPercentageAllocation(rules: unknown[]): boolean {
  let total = 0;
  for (const rule of rules) {
    const amount = (rule as IncomePolicyRule).percentageBasisPoints;
    if (!Number.isSafeInteger(total + amount)) return false;
    total += amount;
  }
  return total === 10000;
}

export function isIncomeApplicationPlan(value: unknown): value is IncomeApplicationPlan {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  return (
    isNonEmptyString(plan.incomeId) &&
    isNonEmptyString(plan.currencyCode) &&
    isPositiveSafeInt(plan.totalAmountMinor) &&
    Array.isArray(plan.applications) &&
    plan.applications.every(isIncomeApplication)
  );
}

export function isIncomePolicyVersion(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const version = value as Record<string, unknown>;
  return (
    isNonEmptyString(version.id) &&
    isPositiveSafeInt(version.version) &&
    typeof version.status === 'string' && POLICY_STATUSES.has(version.status) &&
    Array.isArray(version.rules) && version.rules.length > 0 && version.rules.every(isIncomePolicyRule) &&
    hasFullPercentageAllocation(version.rules) &&
    isNonEmptyString(version.createdAt)
  );
}

export function isIncomePolicy(value: unknown): value is IncomePolicy {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const policy = value as Record<string, unknown>;
  if (!isNonEmptyString(policy.id) || !isNonEmptyString(policy.tenantId) || !isNonEmptyString(policy.categoryId)) {
    return false;
  }
  const versions = policy.versions;
  if (!Array.isArray(versions)) return false;
  return (policy.currentVersion === null || isIncomePolicyVersion(policy.currentVersion)) && versions.every(isIncomePolicyVersion);
}

export function isLegacyBackfillPreviewItem(value: unknown): value is LegacyBackfillPreviewItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    isNonEmptyString(item.incomeId) && isNonEmptyString(item.period) &&
    isNonEmptyString(item.categoryId) && INCOME_SCOPES.has(String(item.scopeType)) &&
    isNullableString(item.buildingId) && INCOME_STATUSES.has(String(item.status)) &&
    isLegacyDestination(item.destination) && isPositiveSafeInt(item.amountMinor) &&
    isNonEmptyString(item.currencyCode) && isNonNegativeInt(item.applicationsCount) &&
    LEGACY_CLASSIFICATIONS.has(String(item.classification)) &&
    (item.relevantBuildings === undefined || (Array.isArray(item.relevantBuildings) && item.relevantBuildings.every(isNonEmptyString)))
  );
}

export function isLegacyBackfillApplyResultItem(value: unknown): value is LegacyBackfillApplyResultItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return isNonEmptyString(item.incomeId) && LEGACY_RESULT_STATUSES.has(String(item.status)) &&
    (item.fundId === undefined || isNullableString(item.fundId));
}

function assertFinancialResponse(condition: boolean, responseName: string): asserts condition {
  if (!condition) {
    throw new TypeError(`Invalid ${responseName} response`);
  }
}

export function parseFund(value: unknown): Fund {
  assertFinancialResponse(isFund(value), 'fund');
  return value;
}

export function parseFunds(value: unknown): Fund[] {
  assertFinancialResponse(Array.isArray(value) && value.every(isFund), 'fund list');
  return value;
}

export function parseFundTransaction(value: unknown): FundTransaction {
  assertFinancialResponse(isFundTransaction(value), 'fund transaction');
  return value;
}

export function parseFundTransactions(value: unknown): FundTransaction[] {
  assertFinancialResponse(Array.isArray(value) && value.every(isFundTransaction), 'fund transaction list');
  return value;
}

export function parseIncomeApplicationPlan(value: unknown): IncomeApplicationPlan {
  assertFinancialResponse(isIncomeApplicationPlan(value), 'income application plan');
  return value;
}

export function parseIncomePolicies(value: unknown): IncomePolicy[] {
  assertFinancialResponse(Array.isArray(value) && value.every(isIncomePolicy), 'income policy list');
  return value;
}

export function parseIncomePolicy(value: unknown): IncomePolicy {
  assertFinancialResponse(isIncomePolicy(value), 'income policy');
  return value;
}

export function parseLegacyBackfillPreview(value: unknown): LegacyBackfillPreviewItem[] {
  assertFinancialResponse(Array.isArray(value) && value.every(isLegacyBackfillPreviewItem), 'legacy backfill preview');
  return value;
}

export function parseLegacyBackfillResults(value: unknown): LegacyBackfillApplyResultItem[] {
  assertFinancialResponse(Array.isArray(value) && value.every(isLegacyBackfillApplyResultItem), 'legacy backfill results');
  return value;
}

/**
 * V3 income offset snapshot item. Campos V3 opcionales/nullables aceptados
 * para compatibilidad V1/V2 histórica.
 */
export function isIncomeOffsetSnapshotItem(value: unknown): value is IncomeOffsetSnapshotItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  if (!isNonEmptyString(item.incomeId) || !isNonEmptyString(item.incomeApplicationId) || !isNonEmptyString(item.categoryId)) {
    return false;
  }
  if (
    !isNullableString(item.categoryName) || !INCOME_SCOPES.has(String(item.scopeType)) ||
    !isNonEmptyString(item.currencyCode) || !isPositiveSafeInt(item.applicationAmountMinor) ||
    !isPositiveSafeInt(item.buildingAmountMinor) || !isPositiveSafeInt(item.valuedAmountMinor) ||
    !isNullableString(item.functionalCurrencyCode) || !isNullableString(item.exchangeRateId) ||
    !isNullableString(item.exchangeRateValue) || !isNullableString(item.exchangeRateDirection) ||
    !isNullableString(item.exchangeRateEffectiveAt) || !isNullableString(item.conversionDate) ||
    !isNonEmptyString(item.receivedDate)
  ) {
    return false;
  }
  if (typeof item.period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.period)) {
    return false;
  }
  const policyVersionId = item.policyVersionId;
  if (!isNullableString(policyVersionId)) {
    return false;
  }
  const legacyDestination = item.legacyDestination;
  if (
    legacyDestination !== null && !isLegacyDestination(legacyDestination)
  ) {
    return false;
  }
  return true;
}

/**
 * Liquidación con summary FIN-06: campos V3 opcionales/nullables.
 * V1/V2 históricas → campos null/ausentes aceptados.
 */
export function isLiquidationV3Summary(value: unknown): value is LiquidationV3Summary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const summary = value as Record<string, unknown>;
  const fields = [
    'grossExpenseAmountMinor',
    'adjustmentAmountMinor',
    'preIncomeAmountMinor',
    'incomeOffsetAmountMinor',
    'netDistributableAmountMinor',
  ] as const;
  const values = fields.map((field) => summary[field]);
  const isLegacy = values.every((entry) => entry === null || entry === undefined);
  if (isLegacy) return true;
  if (!values.every(isNonNegativeInt)) return false;
  const [gross, adjustment, preIncome, offset, net] = values as number[];
  if (!Number.isSafeInteger(gross + adjustment) || gross + adjustment !== preIncome) return false;
  return Number.isSafeInteger(preIncome - offset) && preIncome - offset === net;
}

/** Reject malformed FIN-06 fields while accepting historical V1/V2 nulls. */
export function assertLiquidationV3Summary(value: unknown): void {
  assertFinancialResponse(isLiquidationV3Summary(value), 'liquidation V3 summary');
}
