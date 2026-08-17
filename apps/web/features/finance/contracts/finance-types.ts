/**
 * FIN-07A: contratos de dominio finance (frontend).
 *
 * Fuente de verdad: apps/api (controllers/DTOs). No inferir shapes.
 * Todo monto permanece en amountMinor (entero); sin floats financieros.
 */

// ── Enums (espejo exacto del backend) ──────────────────────────────────────

export type FundScopeType = 'TENANT' | 'BUILDING';
export type FundType = 'RESERVE' | 'SPECIAL' | 'OTHER';
export type FundStatus = 'ACTIVE' | 'ARCHIVED';
export type FundTransactionDirection = 'CREDIT' | 'DEBIT';
export type IncomeApplicationDestination = 'OFFSET_EXPENSES' | 'FUND' | 'CARRY_FORWARD';
export type IncomeDestination = 'APPLY_TO_EXPENSES' | 'RESERVE_FUND' | 'SPECIAL_FUND';
export type IncomeStatus = 'DRAFT' | 'RECORDED' | 'VOID';
export type IncomeScopeType = 'BUILDING' | 'TENANT_SHARED' | 'UNIT_GROUP';
export type IncomePolicyVersionStatus = 'ACTIVE' | 'INACTIVE';
export type LiquidationStatus = 'DRAFT' | 'REVIEWED' | 'PUBLISHED' | 'CANCELED';
export type LiquidationValuationMode = 'FUNCTIONAL' | 'LEGACY_NOMINAL';

// ── Fund (FIN-02) ──────────────────────────────────────────────────────────

export interface FundBalance {
  currency: string;
  amountMinor: number;
}

export interface Fund {
  id: string;
  tenantId: string;
  buildingId: string | null;
  scopeType: FundScopeType;
  type: FundType;
  name: string;
  description: string | null;
  status: FundStatus;
  balancesByCurrency: FundBalance[]; // multi-moneda: nunca colapsar a 1 número
  createdAt: string;
  archivedAt: string | null;
}

export interface CreateFundData {
  scopeType: FundScopeType;
  buildingId?: string;
  type: FundType;
  name: string;
  description?: string;
}

export interface UpdateFundData {
  name?: string;
  description?: string;
}

export interface FundQuery {
  buildingId?: string;
  scopeType?: FundScopeType;
  status?: FundStatus;
}

// ── FundTransaction (FIN-02) ───────────────────────────────────────────────

export interface FundTransaction {
  id: string;
  tenantId: string;
  fundId: string;
  direction: FundTransactionDirection;
  amountMinor: number;
  currencyCode: string;
  occurredAt: string;
  description: string | null;
  idempotencyKey: string | null;
  reversalOfTransactionId: string | null;
  createdAt: string;
}

export interface CreateFundTransactionData {
  direction: FundTransactionDirection;
  amountMinor: number;
  currencyCode: string;
  occurredAt: string;
  description?: string;
  idempotencyKey?: string;
}

export interface ReverseFundTransactionData {
  reason?: string;
}

export interface FundTransactionQuery {
  currencyCode?: string;
  limit?: number;
  offset?: number;
}

// ── Income (FIN-03/04) ─────────────────────────────────────────────────────

export interface Income {
  id: string;
  tenantId: string;
  buildingId: string | null;
  period: string;
  categoryId: string;
  categoryName: string;
  scopeType: IncomeScopeType;
  unitGroupId: string | null;
  destination: IncomeDestination; // legacy metadata; applications son autoritativas
  amountMinor: number;
  currencyCode: string;
  receivedDate: string;
  description: string | null;
  attachmentFileKey: string | null;
  status: IncomeStatus;
  functionalAmountMinor: number | null;
  functionalCurrencyCode: string | null;
  exchangeRateId: string | null;
  exchangeRateValue: string | null;
  exchangeRateDirection: string | null;
  exchangeRateEffectiveAt: string | null;
  conversionDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MovementAllocationInput {
  buildingId: string;
  amountMinor?: number;
  percentage?: number;
  currencyCode?: string;
}

export interface CreateIncomeData {
  period: string;
  categoryId: string;
  amountMinor: number;
  currencyCode: string;
  receivedDate: string;
  description?: string;
  attachmentFileKey?: string;
  scopeType?: IncomeScopeType;
  buildingId?: string;
  unitGroupId?: string;
  allocations?: MovementAllocationInput[];
  destination?: IncomeDestination;
}

export interface UpdateIncomeData {
  amountMinor?: number;
  currencyCode?: string;
  receivedDate?: string;
  categoryId?: string;
  description?: string;
  attachmentFileKey?: string;
}

// ── IncomeApplication (FIN-03/05/04) ───────────────────────────────────────

export interface IncomeApplication {
  id: string;
  tenantId: string;
  incomeId: string;
  destinationType: IncomeApplicationDestination;
  fundId: string | null;
  amountMinor: number;
  currencyCode: string;
  fundTransactionId: string | null;
  policyVersionId: string | null; // FIN-05 provenance
  legacyDestination: IncomeDestination | null; // FIN-04 provenance
  createdAt: string;
}

export interface IncomeApplicationPlan {
  incomeId: string;
  currencyCode: string;
  totalAmountMinor: number;
  applications: IncomeApplication[];
}

export interface CreateIncomeApplicationInput {
  destinationType: IncomeApplicationDestination;
  fundId?: string | null;
  amountMinor: number;
}

export interface CreateIncomeApplicationPlanData {
  applications: CreateIncomeApplicationInput[];
}

// ── IncomePolicy (FIN-05) ──────────────────────────────────────────────────

export interface IncomePolicyRule {
  id: string;
  destinationType: IncomeApplicationDestination;
  fundId: string | null;
  percentageBasisPoints: number; // entero: 10000 = 100%
}

export interface IncomePolicyVersion {
  id: string;
  version: number;
  status: IncomePolicyVersionStatus;
  rules: IncomePolicyRule[];
  createdAt: string;
}

export interface IncomePolicy {
  id: string;
  tenantId: string;
  categoryId: string;
  currentVersion: IncomePolicyVersion | null;
  versions: IncomePolicyVersion[];
}

export interface CreateIncomePolicyRuleData {
  destinationType: IncomeApplicationDestination;
  fundId?: string;
  percentageBasisPoints: number; // entero, nunca float
}

export interface CreateIncomePolicyData {
  categoryId: string;
  rules: CreateIncomePolicyRuleData[];
}

export interface CreateIncomePolicyVersionData {
  rules: CreateIncomePolicyRuleData[];
}

// ── Legacy income backfill (FIN-04) ────────────────────────────────────────

export type LegacyBackfillClassification =
  | 'AUTO_MAPPABLE_OFFSET'
  | 'REQUIRES_RESERVE_FUND'
  | 'REQUIRES_SPECIAL_FUND'
  | 'ALREADY_HAS_PLAN'
  | 'NOT_RECORDED'
  | 'LIQUIDATION_CONFLICT';

export type LegacyBackfillItemStatus =
  | 'MIGRATED'
  | 'ALREADY_MIGRATED'
  | 'ALREADY_HAS_PLAN'
  | 'REQUIRES_FUND'
  | 'INVALID_FUND'
  | 'LIQUIDATION_CONFLICT'
  | 'NOT_RECORDED'
  | 'NOT_FOUND'
  | 'INVALID_INCOME';

export interface LegacyBackfillPreviewItem {
  incomeId: string;
  period: string;
  categoryId: string;
  scopeType: IncomeScopeType;
  buildingId: string | null;
  status: IncomeStatus;
  destination: IncomeDestination;
  amountMinor: number;
  currencyCode: string;
  applicationsCount: number;
  classification: LegacyBackfillClassification;
  relevantBuildings?: string[];
}

export interface LegacyBackfillPreviewQuery {
  period?: string;
  categoryId?: string;
  destination?: IncomeDestination;
}

export interface LegacyBackfillApplyItem {
  incomeId: string;
  fundId?: string | null;
}

export interface LegacyBackfillApplyResultItem {
  incomeId: string;
  status: LegacyBackfillItemStatus;
  fundId?: string | null;
}

// ── Liquidation FIN-06 V3 ──────────────────────────────────────────────────

export interface IncomeOffsetSnapshotItem {
  incomeId: string;
  incomeApplicationId: string;
  categoryId: string;
  categoryName: string | null;
  policyVersionId: string | null;
  legacyDestination: IncomeDestination | null; // FIN-04 provenance
  scopeType: IncomeScopeType;
  currencyCode: string;
  applicationAmountMinor: number;
  buildingAmountMinor: number;
  valuedAmountMinor: number;
  functionalCurrencyCode: string | null;
  exchangeRateId: string | null;
  exchangeRateValue: string | null;
  exchangeRateDirection: string | null;
  exchangeRateEffectiveAt: string | null;
  conversionDate: string | null;
  receivedDate: string;
  period: string;
}

export interface LiquidationV3Summary {
  grossExpenseAmountMinor?: number | null;
  adjustmentAmountMinor?: number | null;
  preIncomeAmountMinor?: number | null;
  incomeOffsetAmountMinor?: number | null;
  netDistributableAmountMinor?: number | null;
}

// Income offset snapshots are FIN-07C foundation only. The current
// liquidation read contract does not expose them.

export interface LiquidationExpenseItem {
  id: string;
  categoryName: string;
  vendorName: string | null;
  amountMinor: number;
  currencyCode: string;
  invoiceDate: string;
  description: string | null;
}

export interface LiquidationChargePreview {
  unitId: string;
  unitCode: string;
  unitLabel: string | null;
  amountMinor: number;
}

export interface Liquidation extends LiquidationV3Summary {
  id: string;
  tenantId: string;
  buildingId: string;
  period: string;
  chargePeriod?: string | null;
  status: LiquidationStatus;
  valuationMode?: LiquidationValuationMode | null;
  baseCurrency: string;
  totalAmountMinor: number;
  totalsByCurrency: Record<string, number>;
  unitCount: number;
  generatedAt: string;
  reviewedAt: string | null;
  publishedAt: string | null;
  canceledAt: string | null;
  createdAt: string;
}

export interface LiquidationDetail extends Liquidation {
  publicationSnapshotStatus: 'AVAILABLE' | 'LEGACY';
  expenses: LiquidationExpenseItem[];
  chargesPreview: LiquidationChargePreview[];
}
