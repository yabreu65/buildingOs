import { calculateChargeOutstandingMinor } from '../finanzas/charge-aggregation';

export const RECONCILIATION_OUTCOMES = [
  'RECONCILED',
  'LEGACY_RECONCILED',
  'REPAIRABLE_DISCREPANCY',
  'INVALID_BLOCKING',
  'INCOMPLETE_OPERATIONAL_ERROR',
] as const;

export type ReconciliationOutcome = (typeof RECONCILIATION_OUTCOMES)[number];

export interface ReconciliationFinding {
  readonly code: string;
  readonly message: string;
}

export interface ReconciliationResult<T = unknown> {
  readonly outcome: ReconciliationOutcome;
  readonly findings: readonly ReconciliationFinding[];
  readonly evidence?: T;
}

export interface HistoricalPaymentEvidence {
  readonly tenantId?: string;
  readonly buildingId?: string;
  readonly unitId?: string | null;
  readonly currency?: string;
  readonly amountMinor?: number;
  readonly functionalAmountMinor?: number | null;
  readonly functionalCurrency?: string | null;
  readonly status?: string | null;
  readonly canceledAt: Date | string | null;
}

export interface HistoricalPaymentAllocationEvidence {
  readonly amount: number;
  readonly payment?: HistoricalPaymentEvidence | null;
}

export interface HistoricalChargeEvidence {
  readonly id: string;
  readonly tenantId: string;
  readonly buildingId: string;
  readonly unitId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly paymentAllocations: readonly HistoricalPaymentAllocationEvidence[];
}

export interface ChargeReconciliationEvidence {
  readonly outstandingMinor: number;
  readonly effectiveAllocatedMinor: number;
}

export interface CurrencyAmountEvidence {
  readonly currency: string;
  readonly amountMinor: number;
}

export interface LiquidationReconciliationEvidence {
  readonly representation: 'V1' | 'V2' | 'V3' | 'ZERO_NET';
  readonly totalAmountMinor: number;
  readonly persistedTotalMinor: number;
  readonly grossExpenseMinor?: number;
  readonly adjustmentMinor?: number;
  readonly offsetMinor?: number;
  readonly valuedAmountMinor?: number;
  readonly functionalCurrency?: string;
  readonly frozenValuation?: {
    readonly originalAmountMinor: number;
    readonly valuedAmountMinor: number;
    readonly functionalCurrency: string;
  };
  readonly expenseSnapshotTotalMinor?: number;
  readonly generatedChargesTotalMinor?: number;
}

export interface HistoricalIncomeApplicationEvidence {
  readonly id?: string;
  readonly tenantId: string;
  readonly amountMinor: number;
  readonly currency: string;
}

export interface HistoricalIncomeEvidence {
  readonly tenantId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly applications: readonly HistoricalIncomeApplicationEvidence[];
  readonly requiresFullAllocation?: boolean;
}

export interface HistoricalFundTransactionEvidence {
  readonly tenantId: string;
  readonly fundId: string;
  readonly direction: 'CREDIT' | 'DEBIT';
  readonly amountMinor: number;
  readonly currency: string;
  readonly application?: {
    readonly tenantId: string;
    readonly fundId: string | null;
    readonly destinationType: string;
    readonly amountMinor: number;
    readonly currency: string;
  } | null;
  readonly duplicateTransactionCount?: number;
}

export interface HistoricalLiquidationIncomeOffsetEvidence {
  readonly tenantId: string;
  readonly buildingId: string;
  readonly liquidation: {
    readonly tenantId: string;
    readonly buildingId: string;
    readonly baseCurrency: string;
  };
  readonly application: {
    readonly tenantId: string;
    readonly amountMinor: number;
    readonly currency: string;
  };
  readonly originalAmountMinor: number;
  readonly currency: string;
  readonly valuedAmountMinor: number;
  readonly baseCurrency: string;
  readonly persistedConversion?: {
    readonly valuedAmountMinor: number;
    readonly baseCurrency: string;
  } | null;
}

export interface HistoricalAdjustmentEvidence {
  readonly tenantId: string;
  readonly buildingId: string;
  readonly sourcePeriod: string;
  readonly targetPeriod: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly status: 'DRAFT' | 'VALIDATED' | 'VOIDED';
  readonly accountingEffect: 'ADDS_TO_LIQUIDATION' | 'NO_DIRECT_DEBT_EFFECT';
}

export interface HistoricalDebtAggregateEvidence {
  readonly charges: readonly HistoricalChargeEvidence[];
  readonly reportedOutstanding: readonly CurrencyAmountEvidence[];
  readonly tenantId: string;
  readonly buildingId?: string;
  readonly unitId?: string;
}

export interface HistoricalMovementAllocationEvidence {
  readonly tenantId: string;
  readonly buildingId: string;
  readonly currency: string;
  readonly amountMinor?: number | null;
  readonly percentage?: number | null;
  readonly parent: {
    readonly tenantId: string;
    readonly buildingId?: string | null;
    readonly amountMinor: number;
    readonly currency: string;
  };
}

export interface HistoricalExpenseLiquidationEvidence {
  readonly tenantId: string;
  readonly buildingId: string | null;
  readonly amountMinor: number;
  readonly currency: string;
  readonly snapshot?: {
    readonly expenseId: string;
    readonly amountMinor: number;
    readonly currency: string;
  } | null;
  readonly legacySnapshotFieldsMissing?: boolean;
}

function finding(code: string, message: string): ReconciliationFinding {
  return { code, message };
}

function result<T>(
  outcome: ReconciliationOutcome,
  findings: readonly ReconciliationFinding[],
  evidence?: T,
): ReconciliationResult<T> {
  return { outcome, findings, ...(evidence === undefined ? {} : { evidence }) };
}

const REPAIRABLE_FINDING_CODES = new Set([
  'DEBT_AGGREGATE_MISMATCH',
  'ALLOCATION_TOTAL_MISMATCH',
  'ALLOCATION_PERCENTAGE_MISMATCH',
]);

function outcomeForFindings(
  findings: readonly ReconciliationFinding[],
  legacy: boolean,
): ReconciliationOutcome {
  if (findings.length === 0) return legacy ? 'LEGACY_RECONCILED' : 'RECONCILED';
  if (findings.every((item) => REPAIRABLE_FINDING_CODES.has(item.code))) {
    return 'REPAIRABLE_DISCREPANCY';
  }
  return 'INVALID_BLOCKING';
}

function isSafeMinor(value: number | null | undefined): value is number {
  return value !== undefined && value !== null && Number.isSafeInteger(value) && value >= 0;
}

function addSafeMinor(left: number, right: number): number | undefined {
  const total = left + right;
  return Number.isSafeInteger(total) ? total : undefined;
}

/**
 * MovementAllocation.percentage is a 0–100 percentage, not a basis-point value.
 * One unit here is one ten-thousandth of a percentage point; 100% = 1,000,000.
 */
function percentageToTenThousandths(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0 || value > 100) return undefined;
  const text = String(value);
  const [wholeText, fractionText = ''] = text.split('.');
  if (wholeText === undefined || !/^\d+$/.test(wholeText) || !/^\d*$/.test(fractionText)) return undefined;
  const scaledText = `${wholeText}${fractionText.padEnd(4, '0').slice(0, 4)}`;
  const fifthFractionDigit = fractionText[4];
  const scaled = Number(scaledText);
  if (!Number.isSafeInteger(scaled)) return undefined;
  return fifthFractionDigit !== undefined && fifthFractionDigit >= '5' ? scaled + 1 : scaled;
}

function isHistoricalCurrency(currency: string): boolean {
  return /^[A-Z]{3}$/.test(currency);
}

/** Reconciles a charge with the canonical charge-side payment effect. */
export function reconcileCharge(
  charge: HistoricalChargeEvidence,
): ReconciliationResult<ChargeReconciliationEvidence> {
  const findings: ReconciliationFinding[] = [];
  if (!isSafeMinor(charge.amountMinor)) {
    findings.push(finding('INVALID_CHARGE_AMOUNT', 'Charge amount must be a non-negative safe integer'));
  }
  if (!isHistoricalCurrency(charge.currency)) {
    findings.push(finding('INVALID_CHARGE_CURRENCY', 'Charge currency is not a three-letter historical currency code'));
  }

  let effectiveAllocatedMinor = 0;
  for (const allocation of charge.paymentAllocations) {
    const payment = allocation.payment;
    if (payment?.tenantId !== undefined && payment.tenantId !== charge.tenantId) {
      findings.push(finding('CROSS_TENANT_EVIDENCE', 'Payment allocation payment belongs to another tenant'));
    }
    if (payment?.buildingId !== undefined && payment.buildingId !== charge.buildingId) {
      findings.push(finding('CROSS_BUILDING_EVIDENCE', 'Payment allocation payment belongs to another building'));
    }
    if (
      payment?.unitId !== undefined
      && payment.unitId !== null
      && payment.unitId !== charge.unitId
    ) {
      findings.push(finding('CROSS_UNIT_EVIDENCE', 'Payment allocation payment belongs to another unit'));
    }
    if (!isSafeMinor(allocation.amount)) {
      findings.push(finding('INVALID_ALLOCATION_AMOUNT', 'Payment allocation amount must be a non-negative safe integer'));
      continue;
    }
    if (payment?.currency !== undefined && payment.currency !== charge.currency) {
      if (payment.functionalCurrency !== charge.currency || !isSafeMinor(payment.functionalAmountMinor)) {
        findings.push(finding('INVALID_CURRENCY_RELATIONSHIP', 'Cross-currency allocation lacks a compatible frozen charge-currency value'));
      } else if (allocation.amount > payment.functionalAmountMinor) {
        findings.push(finding('INVALID_CURRENCY_RELATIONSHIP', 'Cross-currency allocation exceeds the frozen charge-currency value'));
      }
    } else if (payment?.amountMinor !== undefined && allocation.amount > payment.amountMinor) {
      findings.push(finding('INVALID_ALLOCATION_AMOUNT', 'Same-currency allocation exceeds the persisted Payment amount'));
    }
    if (
      payment?.status === 'APPROVED'
      || payment?.status === 'RECONCILED'
    ) {
      if (payment.canceledAt === null) {
        const nextTotal = addSafeMinor(effectiveAllocatedMinor, allocation.amount);
        if (nextTotal === undefined) {
          findings.push(finding('INVALID_ALLOCATION_AMOUNT', 'Effective allocation total exceeds safe integer range'));
        } else {
          effectiveAllocatedMinor = nextTotal;
        }
      }
    }
  }

  if (effectiveAllocatedMinor > charge.amountMinor) {
    findings.push(finding(
      'EFFECTIVE_ALLOCATIONS_EXCEED_CHARGE',
      'Effective persisted payment allocations exceed the charge amount',
    ));
  }

  const outstandingMinor = calculateChargeOutstandingMinor({
    amount: charge.amountMinor,
    paymentAllocations: charge.paymentAllocations,
  });
  return result(
    outcomeForFindings(findings, false),
    findings,
    { outstandingMinor, effectiveAllocatedMinor },
  );
}

/** Aggregates historical amounts without converting or summing currency dimensions. */
export function reconcileCurrencyBuckets(
  values: readonly CurrencyAmountEvidence[],
): ReconciliationResult<{ readonly buckets: readonly CurrencyAmountEvidence[] }> {
  const totals = new Map<string, number>();
  const findings: ReconciliationFinding[] = [];
  let legacy = false;
  for (const value of values) {
    if (!isHistoricalCurrency(value.currency)) {
      findings.push(finding('INVALID_CURRENCY', `Invalid historical currency ${value.currency}`));
      continue;
    }
    if (!isSafeMinor(value.amountMinor)) {
      findings.push(finding('INVALID_AMOUNT', 'Currency amount must be a non-negative safe integer'));
      continue;
    }
    if (value.currency !== 'USD' && value.currency !== 'VES' && value.currency !== 'ARS' && value.currency !== 'COP') {
      legacy = true;
    }
    const nextTotal = addSafeMinor(totals.get(value.currency) ?? 0, value.amountMinor);
    if (nextTotal === undefined) {
      findings.push(finding('INVALID_AMOUNT', `Currency aggregate exceeds safe integer range for ${value.currency}`));
    } else {
      totals.set(value.currency, nextTotal);
    }
  }
  const buckets = [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amountMinor]) => ({ currency, amountMinor }));
  return result(outcomeForFindings(findings, legacy), findings, { buckets });
}

export function reconcileDebtAggregate(
  aggregate: HistoricalDebtAggregateEvidence,
): ReconciliationResult<{ readonly canonicalOutstanding: readonly CurrencyAmountEvidence[] }> {
  const findings: ReconciliationFinding[] = [];
  const canonical = new Map<string, number>();
  for (const charge of aggregate.charges) {
    if (charge.tenantId !== aggregate.tenantId || (aggregate.buildingId !== undefined && charge.buildingId !== aggregate.buildingId) || (aggregate.unitId !== undefined && charge.unitId !== aggregate.unitId)) {
      findings.push(finding('CROSS_SCOPE_EVIDENCE', 'Charge does not belong to the requested tenant/building/unit scope'));
      continue;
    }
    const chargeResult = reconcileCharge(charge);
    findings.push(...chargeResult.findings);
    const outstanding = chargeResult.evidence?.outstandingMinor ?? 0;
    const nextTotal = addSafeMinor(canonical.get(charge.currency) ?? 0, outstanding);
    if (nextTotal === undefined) {
      findings.push(finding('INVALID_DEBT_AGGREGATE', `Outstanding aggregate exceeds safe integer range for ${charge.currency}`));
    } else {
      canonical.set(charge.currency, nextTotal);
    }
  }
  const reported = new Map<string, number>();
  for (const bucket of aggregate.reportedOutstanding) {
    if (!isHistoricalCurrency(bucket.currency) || !isSafeMinor(bucket.amountMinor)) {
      findings.push(finding('INVALID_DEBT_AGGREGATE', 'Reported outstanding bucket is not valid historical money'));
      continue;
    }
    const nextTotal = addSafeMinor(reported.get(bucket.currency) ?? 0, bucket.amountMinor);
    if (nextTotal === undefined) {
      findings.push(finding('INVALID_DEBT_AGGREGATE', `Reported aggregate exceeds safe integer range for ${bucket.currency}`));
    } else {
      reported.set(bucket.currency, nextTotal);
    }
  }
  const currencies = new Set([...canonical.keys(), ...reported.keys()]);
  for (const currency of currencies) {
    const expectedAmountMinor = canonical.get(currency) ?? 0;
    const reportedAmountMinor = reported.get(currency) ?? 0;
    if (expectedAmountMinor !== reportedAmountMinor) {
      findings.push(finding('DEBT_AGGREGATE_MISMATCH', `Outstanding aggregate mismatch for ${currency}: expected ${expectedAmountMinor}, reported ${reportedAmountMinor}`));
    }
  }
  const canonicalOutstanding = [...canonical.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amountMinor]) => ({ currency, amountMinor }));
  const reportedOutstanding = [...reported.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amountMinor]) => ({ currency, amountMinor }));
  return result(
    outcomeForFindings(findings, canonicalOutstanding.some((item) => !isCanonicalCurrency(item.currency))),
    findings,
    { canonicalOutstanding, reportedOutstanding },
  );
}

export function reconcileMovementAllocations(
  allocations: readonly HistoricalMovementAllocationEvidence[],
): ReconciliationResult {
  const findings: ReconciliationFinding[] = [];
  if (allocations.length === 0) {
    findings.push(finding('INVALID_ALLOCATIONS', 'Movement must have at least one allocation'));
    return result(outcomeForFindings(findings, false), findings);
  }
  const firstAllocation = allocations[0];
  if (firstAllocation === undefined) {
    findings.push(finding('INVALID_ALLOCATIONS', 'Movement must have at least one allocation'));
    return result(outcomeForFindings(findings, false), findings);
  }
  const parent = firstAllocation.parent;
  const modes = new Set(allocations.map((allocation) => allocation.amountMinor !== null && allocation.amountMinor !== undefined ? 'AMOUNT' : 'PERCENTAGE'));
  if (modes.size !== 1) findings.push(finding('INVALID_ALLOCATION_MODE', 'Movement allocations must use one persisted allocation mode'));
  let amountTotal = 0;
  let percentageTenThousandthsTotal = 0;
  for (const allocation of allocations) {
    if (allocation.tenantId !== parent.tenantId || (parent.buildingId !== undefined && parent.buildingId !== null && allocation.buildingId !== parent.buildingId)) {
      findings.push(finding('CROSS_SCOPE_EVIDENCE', 'Movement allocation does not belong to the parent scope'));
    }
    if (allocation.currency !== parent.currency) findings.push(finding('INVALID_ALLOCATION_CURRENCY', 'Movement allocation currency differs from parent currency'));
    if (allocation.amountMinor !== null && allocation.amountMinor !== undefined) {
      if (!isSafeMinor(allocation.amountMinor)) {
        findings.push(finding('INVALID_ALLOCATION_AMOUNT', 'Movement allocation amount must be a non-negative safe integer'));
      } else {
        const nextTotal = addSafeMinor(amountTotal, allocation.amountMinor);
        if (nextTotal === undefined) findings.push(finding('INVALID_ALLOCATION_AMOUNT', 'Movement allocation total exceeds safe integer range'));
        else amountTotal = nextTotal;
      }
    }
    if (allocation.percentage !== null && allocation.percentage !== undefined) {
      const percentageTenThousandths = percentageToTenThousandths(allocation.percentage);
      if (percentageTenThousandths === undefined) findings.push(finding('INVALID_ALLOCATION_PERCENTAGE', 'Movement allocation percentage is not exact persisted evidence'));
      else percentageTenThousandthsTotal += percentageTenThousandths;
    }
  }
  if (modes.has('AMOUNT') && amountTotal !== parent.amountMinor) findings.push(finding('ALLOCATION_TOTAL_MISMATCH', `Movement allocation amounts do not equal the persisted parent total: expected ${parent.amountMinor}, reported ${amountTotal}`));
  if (modes.has('PERCENTAGE') && percentageTenThousandthsTotal !== 1_000_000) findings.push(finding('ALLOCATION_PERCENTAGE_MISMATCH', `Movement allocation percentages do not equal 100%: expected 1000000 ten-thousandths of a percentage point, reported ${percentageTenThousandthsTotal}`));
  return result(
    outcomeForFindings(findings, parent.currency !== 'USD' && parent.currency !== 'VES' && parent.currency !== 'ARS' && parent.currency !== 'COP'),
    findings,
    { amountTotal, percentageTenThousandthsTotal, expectedAmountMinor: parent.amountMinor, expectedPercentageTenThousandths: 1_000_000 },
  );
}

export function reconcileLiquidation(
  liquidation: LiquidationReconciliationEvidence,
): ReconciliationResult {
  const findings: ReconciliationFinding[] = [];
  if (!isSafeMinor(liquidation.totalAmountMinor) || !isSafeMinor(liquidation.persistedTotalMinor)) {
    findings.push(finding('INVALID_LIQUIDATION_AMOUNT', 'Liquidation totals must be non-negative safe integers'));
  }
  if (liquidation.totalAmountMinor !== liquidation.persistedTotalMinor) {
    findings.push(finding('IMMUTABLE_TOTAL_MISMATCH', 'Persisted liquidation total does not match the historical total'));
  }
  if (liquidation.representation === 'V2') {
    const frozenValuation = liquidation.frozenValuation;
    if (
      !isSafeMinor(liquidation.valuedAmountMinor)
      || liquidation.functionalCurrency === undefined
      || frozenValuation === undefined
      || !isSafeMinor(frozenValuation.originalAmountMinor)
      || !isSafeMinor(frozenValuation.valuedAmountMinor)
      || frozenValuation.functionalCurrency !== liquidation.functionalCurrency
      || frozenValuation.valuedAmountMinor !== liquidation.totalAmountMinor
    ) {
      findings.push(finding('INVALID_V2_VALUATION_SNAPSHOT', 'V2 requires consistent persisted original, valued, and functional-currency evidence'));
    }
  }
  if (liquidation.representation === 'V3' || liquidation.representation === 'ZERO_NET') {
    const { grossExpenseMinor, adjustmentMinor, offsetMinor } = liquidation;
    if (!isSafeMinor(grossExpenseMinor) || !isSafeMinor(adjustmentMinor) || !isSafeMinor(offsetMinor)) {
      findings.push(finding('INVALID_V3_SUMMARY', 'V3 requires persisted gross, adjustment, and offset totals'));
    } else if (grossExpenseMinor + adjustmentMinor - offsetMinor !== liquidation.totalAmountMinor) {
      findings.push(finding('INVALID_V3_SUMMARY', 'V3 total does not equal gross plus adjustment minus offset'));
    }
    if (liquidation.representation === 'ZERO_NET' && liquidation.totalAmountMinor !== 0) {
      findings.push(finding('INVALID_ZERO_NET', 'ZERO_NET liquidation must have a zero net total'));
    }
  }
  if (
    liquidation.expenseSnapshotTotalMinor !== undefined
    && liquidation.generatedChargesTotalMinor !== undefined
    && liquidation.expenseSnapshotTotalMinor !== liquidation.generatedChargesTotalMinor
  ) {
    findings.push(finding('GENERATED_CHARGES_TOTAL_MISMATCH', 'Generated charge total disagrees with persisted liquidation evidence'));
  }
  return result(outcomeForFindings(findings, liquidation.representation === 'V1' || liquidation.representation === 'V2'), findings);
}

export function reconcileIncome(income: HistoricalIncomeEvidence): ReconciliationResult {
  const findings: ReconciliationFinding[] = [];
  let appliedMinor = 0;
  const ids = new Set<string>();
  for (const application of income.applications) {
    if (application.tenantId !== income.tenantId) {
      findings.push(finding('CROSS_TENANT_EVIDENCE', 'Income application belongs to another tenant'));
    }
    if (application.currency !== income.currency) {
      findings.push(finding('INVALID_APPLICATION_CURRENCY', 'Income application currency differs from Income currency'));
    }
    if (application.id !== undefined && ids.has(application.id)) {
      findings.push(finding('DUPLICATE_APPLICATION', 'Income application is counted more than once'));
    }
    if (application.id !== undefined) ids.add(application.id);
    if (!isSafeMinor(application.amountMinor)) {
      findings.push(finding('INVALID_APPLICATION_AMOUNT', 'Income application amount must be a non-negative safe integer'));
    } else {
      appliedMinor += application.amountMinor;
    }
  }
  if (!isSafeMinor(income.amountMinor) || appliedMinor > income.amountMinor) {
    findings.push(finding('APPLICATIONS_EXCEED_INCOME', 'Income applications exceed the persisted Income amount'));
  }
  const remainingMinor = income.amountMinor - appliedMinor;
  if (income.requiresFullAllocation === true && appliedMinor !== income.amountMinor) {
    findings.push(finding('INCOMPLETE_APPLICATIONS', 'This Income contract requires full application'));
  }
  return result(
    outcomeForFindings(findings, false),
    findings,
    { appliedMinor, remainingMinor },
  );
}

export function reconcileFundTransaction(
  transaction: HistoricalFundTransactionEvidence,
): ReconciliationResult {
  const findings: ReconciliationFinding[] = [];
  const application = transaction.application;
  if (!isSafeMinor(transaction.amountMinor) || transaction.amountMinor === 0) {
    findings.push(finding('INVALID_FUND_AMOUNT', 'Fund transaction amount must be positive'));
  }
  if (application !== undefined && application !== null) {
    if (application.tenantId !== transaction.tenantId || application.fundId !== transaction.fundId) {
      findings.push(finding('CROSS_TENANT_EVIDENCE', 'Fund application does not belong to the transaction scope'));
    }
    if (application.destinationType !== 'FUND' || application.amountMinor !== transaction.amountMinor || application.currency !== transaction.currency) {
      findings.push(finding('INVALID_FUND_PROVENANCE', 'Fund transaction does not match its FUND application'));
    }
    if (transaction.direction !== 'CREDIT') {
      findings.push(finding('INVALID_FUND_DIRECTION', 'IncomeApplication provenance must create a CREDIT transaction'));
    }
  }
  if ((transaction.duplicateTransactionCount ?? 0) > 0) {
    findings.push(finding('DUPLICATE_FUND_EFFECT', 'More than one FundTransaction represents the same application effect'));
  }
  return result(outcomeForFindings(findings, transaction.currency !== 'USD' && transaction.currency !== 'VES' && transaction.currency !== 'ARS' && transaction.currency !== 'COP'), findings);
}

export function reconcileLiquidationIncomeOffset(
  offset: HistoricalLiquidationIncomeOffsetEvidence,
): ReconciliationResult {
  const findings: ReconciliationFinding[] = [];
  if (offset.tenantId !== offset.liquidation.tenantId || offset.tenantId !== offset.application.tenantId) {
    findings.push(finding('CROSS_TENANT_EVIDENCE', 'Offset links records across tenants'));
  }
  if (offset.buildingId !== offset.liquidation.buildingId) {
    findings.push(finding('CROSS_BUILDING_EVIDENCE', 'Offset building differs from liquidation building'));
  }
  if (offset.baseCurrency !== offset.liquidation.baseCurrency) {
    findings.push(finding('INVALID_OFFSET_BASE_CURRENCY', 'Offset base currency differs from liquidation base currency'));
  }
  if (
    !isSafeMinor(offset.originalAmountMinor)
    || !isSafeMinor(offset.valuedAmountMinor)
    || offset.currency !== offset.application.currency
    || offset.originalAmountMinor > offset.application.amountMinor
  ) {
    findings.push(finding('INVALID_OFFSET_ORIGINAL_EVIDENCE', 'Offset original amount/currency disagrees with IncomeApplication'));
  }
  const hasPersistedConversion = offset.persistedConversion !== undefined && offset.persistedConversion !== null;
  if (hasPersistedConversion && (
    offset.persistedConversion.valuedAmountMinor !== offset.valuedAmountMinor
    || offset.persistedConversion.baseCurrency !== offset.baseCurrency
  )) {
    findings.push(finding('INVALID_OFFSET_CONVERSION_EVIDENCE', 'Persisted immutable conversion evidence disagrees with offset totals'));
  }
  if (offset.currency !== offset.baseCurrency && !hasPersistedConversion) {
    findings.push(finding('INVALID_OFFSET_CONVERSION_EVIDENCE', 'Cross-currency offset lacks persisted frozen conversion evidence'));
  }
  return result(outcomeForFindings(findings, false), findings);
}

export function reconcileExpenseLiquidation(
  expense: HistoricalExpenseLiquidationEvidence,
): ReconciliationResult<{ readonly directDebtEffectMinor: 0 }> {
  const findings: ReconciliationFinding[] = [];
  if (!isSafeMinor(expense.amountMinor)) {
    findings.push(finding('INVALID_EXPENSE_AMOUNT', 'Expense amount must be a non-negative safe integer'));
  }
  if (expense.snapshot === null && expense.legacySnapshotFieldsMissing === true) {
    return result(outcomeForFindings(findings, true), findings, { directDebtEffectMinor: 0 });
  }
  if (expense.snapshot === undefined || expense.snapshot === null) {
    findings.push(finding('MISSING_EXPENSE_SNAPSHOT', 'Current-format expense evidence lacks its liquidation snapshot'));
  } else if (
    expense.snapshot.amountMinor !== expense.amountMinor
    || expense.snapshot.currency !== expense.currency
  ) {
    findings.push(finding('EXPENSE_SNAPSHOT_MISMATCH', 'Liquidation snapshot disagrees with the persisted Expense'));
  }
  return result(outcomeForFindings(findings, false), findings, { directDebtEffectMinor: 0 });
}

export function reconcileAdjustment(adjustment: HistoricalAdjustmentEvidence): ReconciliationResult {
  const findings: ReconciliationFinding[] = [];
  if (!isSafeMinor(adjustment.amountMinor) || adjustment.amountMinor === 0) {
    findings.push(finding('INVALID_ADJUSTMENT_AMOUNT', 'Adjustment amount must be positive'));
  }
  if (adjustment.status === 'VOIDED' && adjustment.accountingEffect === 'ADDS_TO_LIQUIDATION') {
    findings.push(finding('INVALID_VOIDED_ADJUSTMENT_EFFECT', 'Voided adjustment cannot retain an active liquidation effect'));
  }
  return result(outcomeForFindings(findings, !isCanonicalCurrency(adjustment.currency)), findings);
}

function isCanonicalCurrency(currency: string): boolean {
  return currency === 'USD' || currency === 'VES' || currency === 'ARS' || currency === 'COP';
}
