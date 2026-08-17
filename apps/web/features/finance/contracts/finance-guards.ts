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

export function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
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
    typeof (value as FundBalance).currency === 'string' &&
    isNonNegativeInt((value as FundBalance).amountMinor)
  );
}

export function isFund(value: unknown): value is Fund {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fund = value as Record<string, unknown>;
  if (typeof fund.id !== 'string' || typeof fund.tenantId !== 'string') {
    return false;
  }
  if (
    typeof fund.name !== 'string' ||
    !['TENANT', 'BUILDING'].includes(String(fund.scopeType)) ||
    !['RESERVE', 'SPECIAL', 'OTHER'].includes(String(fund.type)) ||
    !['ACTIVE', 'ARCHIVED'].includes(String(fund.status))
  ) {
    return false;
  }
  if (!Array.isArray(fund.balancesByCurrency)) {
    return false;
  }
  // Fail-closed: cada balance debe ser válido; un balance inválido invalida el Fund.
  return fund.balancesByCurrency.every(isFundBalance);
}

export function isFundTransaction(value: unknown): value is FundTransaction {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const transaction = value as Record<string, unknown>;
  return (
    typeof transaction.id === 'string' &&
    typeof transaction.tenantId === 'string' &&
    typeof transaction.fundId === 'string' &&
    ['CREDIT', 'DEBIT'].includes(String(transaction.direction)) &&
    typeof transaction.currencyCode === 'string' &&
    isNonNegativeInt(transaction.amountMinor)
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
  if (typeof app.id !== 'string' || typeof app.incomeId !== 'string') {
    return false;
  }
  if (!isDestination(app.destinationType)) {
    return false;
  }
  if (!isNonNegativeInt(app.amountMinor) || typeof app.currencyCode !== 'string') {
    return false;
  }
  const policyVersionId = app.policyVersionId;
  const legacyDestination = app.legacyDestination;
  if (policyVersionId !== null && policyVersionId !== undefined && typeof policyVersionId !== 'string') {
    return false;
  }
  if (
    legacyDestination !== null &&
    legacyDestination !== undefined &&
    !isLegacyDestination(legacyDestination)
  ) {
    return false;
  }
  // Mutuamente excluyentes (espejo del CHECK DB).
  if (policyVersionId != null && legacyDestination != null) {
    return false;
  }
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
  if (!isDestination(rule.destinationType)) {
    return false;
  }
  return (
    typeof rule.percentageBasisPoints === 'number' &&
    Number.isSafeInteger(rule.percentageBasisPoints) &&
    (rule.percentageBasisPoints as number) >= 1 &&
    (rule.percentageBasisPoints as number) <= 10000
  );
}

export function isIncomeApplicationPlan(value: unknown): value is IncomeApplicationPlan {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  return (
    typeof plan.incomeId === 'string' &&
    typeof plan.currencyCode === 'string' &&
    isNonNegativeInt(plan.totalAmountMinor) &&
    Array.isArray(plan.applications) &&
    plan.applications.every(isIncomeApplication)
  );
}

export function isIncomePolicy(value: unknown): value is IncomePolicy {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const policy = value as Record<string, unknown>;
  if (typeof policy.id !== 'string' || typeof policy.tenantId !== 'string' || typeof policy.categoryId !== 'string') {
    return false;
  }
  const versions = policy.versions;
  if (!Array.isArray(versions)) return false;
  return versions.every((version) => {
    if (typeof version !== 'object' || version === null || Array.isArray(version)) return false;
    const record = version as Record<string, unknown>;
    return (
      typeof record.id === 'string' &&
      isNonNegativeInt(record.version) &&
      ['ACTIVE', 'INACTIVE'].includes(String(record.status)) &&
      Array.isArray(record.rules) &&
      record.rules.every(isIncomePolicyRule)
    );
  });
}

export function isLegacyBackfillPreviewItem(value: unknown): value is LegacyBackfillPreviewItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.incomeId === 'string' &&
    typeof item.period === 'string' &&
    typeof item.categoryId === 'string' &&
    typeof item.currencyCode === 'string' &&
    isNonNegativeInt(item.amountMinor) &&
    isLegacyDestination(item.destination)
  );
}

export function isLegacyBackfillApplyResultItem(value: unknown): value is LegacyBackfillApplyResultItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.incomeId === 'string' && typeof item.status === 'string';
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
  if (typeof item.incomeId !== 'string' || typeof item.incomeApplicationId !== 'string') {
    return false;
  }
  if (!isNonNegativeInt(item.applicationAmountMinor) || !isNonNegativeInt(item.valuedAmountMinor)) {
    return false;
  }
  if (typeof item.period !== 'string') {
    return false;
  }
  const policyVersionId = item.policyVersionId;
  if (policyVersionId !== null && policyVersionId !== undefined && typeof policyVersionId !== 'string') {
    return false;
  }
  const legacyDestination = item.legacyDestination;
  if (
    legacyDestination !== null &&
    legacyDestination !== undefined &&
    !isLegacyDestination(legacyDestination)
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
  for (const field of fields) {
    const fieldValue = summary[field];
    if (fieldValue === null || fieldValue === undefined) {
      continue; // legacy V1/V2: null aceptado
    }
    if (!isNonNegativeInt(fieldValue)) {
      return false;
    }
  }
  const snapshot = summary.incomeOffsetSnapshot;
  if (snapshot !== null && snapshot !== undefined) {
    if (!Array.isArray(snapshot) || !snapshot.every(isIncomeOffsetSnapshotItem)) {
      return false;
    }
  }
  const byCurrency = summary.incomeOffsetsByCurrency;
  if (byCurrency !== null && byCurrency !== undefined) {
    if (typeof byCurrency !== 'object' || Array.isArray(byCurrency)) {
      return false;
    }
    for (const amount of Object.values(byCurrency as Record<string, unknown>)) {
      if (!isNonNegativeInt(amount)) {
        return false;
      }
    }
  }
  return true;
}

/** Reject malformed FIN-06 fields while accepting historical V1/V2 nulls. */
export function assertLiquidationV3Summary(value: unknown): void {
  assertFinancialResponse(isLiquidationV3Summary(value), 'liquidation V3 summary');
}
