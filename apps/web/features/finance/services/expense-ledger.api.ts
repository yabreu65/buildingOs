import { apiClient } from '@/shared/lib/http/client';
import { assertLiquidationV3Summary } from '../contracts/finance-guards';

// ── Types ──────────────────────────────────────────────────────────────────

export type ExpenseStatus = 'DRAFT' | 'VALIDATED' | 'VOID';
export type IncomeStatus = 'DRAFT' | 'RECORDED' | 'VOID';
export type LiquidationStatus = 'DRAFT' | 'REVIEWED' | 'PUBLISHED' | 'CANCELED';
export type LiquidationValuationMode = 'FUNCTIONAL' | 'LEGACY_NOMINAL';
export type CatalogScope = 'BUILDING' | 'CONDOMINIUM_COMMON';

export interface ExpenseLedgerCategory {
  id: string;
  tenantId: string;
  code: string | null;
  name: string;
  description: string | null;
  movementType: 'EXPENSE' | 'INCOME';
  catalogScope: CatalogScope;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Expense {
  id: string;
  tenantId: string;
  buildingId: string | null;
  period: string;
  liquidationPeriod?: string;
  categoryId: string;
  categoryName: string;
  vendorId: string | null;
  vendorName: string | null;
  amountMinor: number;
  currencyCode: string;
  invoiceDate: string;
  description: string | null;
  attachmentFileKey: string | null;
  status: ExpenseStatus;
  scopeType: ExpenseScopeType;
  unitGroupId: string | null;
  functionalAmountMinor?: number | null;
  functionalCurrencyCode?: string | null;
  exchangeRateId?: string | null;
  exchangeRateValue?: string | null;
  exchangeRateDirection?: string | null;
  exchangeRateEffectiveAt?: string | null;
  conversionDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Income {
  id: string;
  tenantId: string;
  buildingId: string | null;
  period: string;
  categoryId: string;
  categoryName: string;
  amountMinor: number;
  currencyCode: string;
  receivedDate: string;
  description: string | null;
  attachmentFileKey: string | null;
  status: IncomeStatus;
  createdAt: string;
  updatedAt: string;
  // FIN-07A: metadata multicurrency/scope (backend toDto)
  scopeType?: 'BUILDING' | 'TENANT_SHARED' | 'UNIT_GROUP';
  unitGroupId?: string | null;
  destination?: 'APPLY_TO_EXPENSES' | 'RESERVE_FUND' | 'SPECIAL_FUND';
  functionalAmountMinor?: number | null;
  functionalCurrencyCode?: string | null;
  exchangeRateId?: string | null;
  exchangeRateValue?: string | null;
  exchangeRateDirection?: string | null;
  exchangeRateEffectiveAt?: string | null;
  conversionDate?: string | null;
}

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

export interface Liquidation {
  id: string;
  tenantId: string;
  buildingId: string;
  period: string;
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
  // FIN-06 V3: resumen del neto distributable (nullable = histórico V1/V2)
  grossExpenseAmountMinor?: number | null;
  adjustmentAmountMinor?: number | null;
  preIncomeAmountMinor?: number | null;
  incomeOffsetAmountMinor?: number | null;
  netDistributableAmountMinor?: number | null;
}

export interface LiquidationDetail extends Liquidation {
  expenses: LiquidationExpenseItem[];
  chargesPreview: LiquidationChargePreview[];
}

export interface BulkValidateExpensesResult {
  validatedCount: number;
  errorCount: number;
}

export type RecurringExpenseAllocationMode =
  | 'MANUAL'
  | 'EQUAL_SHARE'
  | 'BUILDING_TOTAL_M2';

export type RecurringExpenseScopeType = 'BUILDING' | 'TENANT_SHARED';

export interface RecurringExpense {
  id: string;
  tenantId: string;
  buildingId: string | null;
  scopeType: RecurringExpenseScopeType;
  allocationMode: RecurringExpenseAllocationMode | null;
  categoryId: string;
  amount: number;
  currency: string;
  concept: string;
  frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  nextRunDate: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringExpenseAllocationInput {
  buildingId: string;
  percentage: number;
}

export interface CreateTenantRecurringExpenseData {
  scopeType: 'TENANT_SHARED';
  allocationMode: RecurringExpenseAllocationMode;
  categoryId: string;
  amount: number;
  currency: string;
  concept: string;
  frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  allocations?: RecurringExpenseAllocationInput[];
}

export interface CreateRecurringExpenseData {
  categoryId: string;
  amount: number;
  currency: string;
  concept: string;
  frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
}

export interface UpdateRecurringExpenseData {
  isActive?: boolean;
  amount?: number;
  concept?: string;
}

// ── ExpenseLedgerCategories API ────────────────────────────────────────────

export async function listExpenseLedgerCategories(
  tenantId: string,
  movementType?: 'EXPENSE' | 'INCOME',
  catalogScope?: CatalogScope,
): Promise<ExpenseLedgerCategory[]> {
  const qs = new URLSearchParams();
  if (movementType) qs.append('movementType', movementType);
  if (catalogScope) qs.append('catalogScope', catalogScope);

  const queryStr = qs.toString();
  return apiClient<ExpenseLedgerCategory[]>({
    path: `/tenants/${tenantId}/finance/expense-categories${queryStr ? '?' + queryStr : ''}`,
    method: 'GET',
  });
}

export async function createExpenseLedgerCategory(
  tenantId: string,
  data: { name: string; description?: string; movementType?: 'EXPENSE' | 'INCOME'; catalogScope?: CatalogScope },
): Promise<ExpenseLedgerCategory> {
  return apiClient<ExpenseLedgerCategory, typeof data>({
    path: `/tenants/${tenantId}/finance/expense-categories`,
    method: 'POST',
    body: data,
  });
}

export async function updateExpenseLedgerCategory(
  tenantId: string,
  categoryId: string,
  data: { name?: string; description?: string; isActive?: boolean },
): Promise<ExpenseLedgerCategory> {
  return apiClient<ExpenseLedgerCategory, typeof data>({
    path: `/tenants/${tenantId}/finance/expense-categories/${categoryId}`,
    method: 'PATCH',
    body: data,
  });
}

export async function deleteExpenseLedgerCategory(
  tenantId: string,
  categoryId: string,
): Promise<void> {
  await apiClient({
    path: `/tenants/${tenantId}/finance/expense-categories/${categoryId}`,
    method: 'DELETE',
  });
}

// ── Expenses API ───────────────────────────────────────────────────────────

export type ExpenseScopeType = 'BUILDING' | 'TENANT_SHARED' | 'UNIT_GROUP';

export interface ListExpensesParams {
  buildingId?: string;
  period?: string;
  status?: ExpenseStatus;
  categoryId?: string;
  scopeType?: ExpenseScopeType;
  limit?: number;
  offset?: number;
}

export async function listExpenses(
  tenantId: string,
  params: ListExpensesParams = {},
): Promise<Expense[]> {
  const qs = new URLSearchParams();
  if (params.buildingId) qs.append('buildingId', params.buildingId);
  if (params.period) qs.append('period', params.period);
  if (params.status) qs.append('status', params.status);
  if (params.categoryId) qs.append('categoryId', params.categoryId);
  if (params.scopeType) qs.append('scopeType', params.scopeType);
  if (params.limit) qs.append('limit', String(params.limit));
  if (params.offset) qs.append('offset', String(params.offset));

  const queryStr = qs.toString();
  return apiClient<Expense[]>({
    path: `/tenants/${tenantId}/finance/expenses${queryStr ? '?' + queryStr : ''}`,
    method: 'GET',
  });
}

export async function getExpense(
  tenantId: string,
  expenseId: string,
): Promise<Expense> {
  return apiClient<Expense>({
    path: `/tenants/${tenantId}/finance/expenses/${expenseId}`,
    method: 'GET',
  });
}

export interface AllocationInput {
  buildingId: string;
  percentage?: number;
  amountMinor?: number;
  currencyCode?: string;
}

export interface AllocationSuggestion {
  buildingId: string;
  buildingName: string;
  totalM2: number;
  percentage: number;
}

export interface CreateExpenseData {
  buildingId?: string;
  period: string;
  categoryId: string;
  vendorId?: string;
  amountMinor: number;
  currencyCode: string;
  invoiceDate: string;
  description?: string;
  attachmentFileKey?: string;
  scopeType?: ExpenseScopeType;
  unitGroupId?: string;
  allocations?: AllocationInput[];
}

export async function createExpense(
  tenantId: string,
  data: CreateExpenseData,
): Promise<Expense> {
  return apiClient<Expense, CreateExpenseData>({
    path: `/tenants/${tenantId}/finance/expenses`,
    method: 'POST',
    body: data,
  });
}

export async function updateExpense(
  tenantId: string,
  expenseId: string,
  data: Partial<CreateExpenseData>,
): Promise<Expense> {
  return apiClient<Expense, Partial<CreateExpenseData>>({
    path: `/tenants/${tenantId}/finance/expenses/${expenseId}`,
    method: 'PATCH',
    body: data,
  });
}

export async function validateExpense(
  tenantId: string,
  expenseId: string,
): Promise<Expense> {
  return apiClient<Expense>({
    path: `/tenants/${tenantId}/finance/expenses/${expenseId}/validate`,
    method: 'POST',
  });
}

export async function voidExpense(
  tenantId: string,
  expenseId: string,
): Promise<Expense> {
  return apiClient<Expense>({
    path: `/tenants/${tenantId}/finance/expenses/${expenseId}/void`,
    method: 'POST',
  });
}

export async function bulkValidateExpenses(
  buildingId: string,
  periodId?: string,
): Promise<BulkValidateExpensesResult> {
  const qs = new URLSearchParams();
  if (periodId) qs.append('periodId', periodId);

  const queryStr = qs.toString();
  return apiClient<BulkValidateExpensesResult>({
    path: `/buildings/${buildingId}/expenses/validate-all${queryStr ? '?' + queryStr : ''}`,
    method: 'PATCH',
  });
}

// ── Tenant Charges ─────────────────────────────────────────────────────────

export interface TenantCharge {
  id: string;
  buildingId: string;
  building: { id: string; name: string };
  unitId: string;
  unit: { id: string; label: string };
  amount: number;
  currency: string;
  dueDate: string;
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'CANCELED';
  concept: string;
  createdAt: string;
}

export interface ListTenantChargesParams {
  buildingId?: string;
  period?: string;
  status?: TenantCharge['status'];
  limit?: number;
  offset?: number;
}

export async function listTenantCharges(
  tenantId: string,
  params: ListTenantChargesParams = {},
): Promise<TenantCharge[]> {
  const qs = new URLSearchParams();
  if (params.buildingId) qs.append('buildingId', params.buildingId);
  if (params.period) qs.append('period', params.period);
  if (params.status) qs.append('status', params.status);
  if (params.limit) qs.append('limit', String(params.limit));
  if (params.offset) qs.append('offset', String(params.offset));

  const queryStr = qs.toString();
  return apiClient<TenantCharge[]>({
    path: `/tenants/${tenantId}/finance/charges${queryStr ? '?' + queryStr : ''}`,
    method: 'GET',
  });
}

export async function listRecurringExpenses(
  buildingId: string,
): Promise<RecurringExpense[]> {
  return apiClient<RecurringExpense[]>({
    path: `/buildings/${buildingId}/recurring-expenses`,
    method: 'GET',
  });
}

export async function createRecurringExpense(
  buildingId: string,
  data: CreateRecurringExpenseData,
): Promise<RecurringExpense> {
  return apiClient<RecurringExpense, CreateRecurringExpenseData>({
    path: `/buildings/${buildingId}/recurring-expenses`,
    method: 'POST',
    body: data,
  });
}

export async function updateRecurringExpense(
  buildingId: string,
  recurringExpenseId: string,
  data: UpdateRecurringExpenseData,
): Promise<RecurringExpense> {
  return apiClient<RecurringExpense, UpdateRecurringExpenseData>({
    path: `/buildings/${buildingId}/recurring-expenses/${recurringExpenseId}`,
    method: 'PATCH',
    body: data,
  });
}

// ── Tenant-shared RecurringExpenses API ─────────────────────────────────────
// TENANT_SHARED scope: multi-building rules managed at tenant level.

export async function listTenantRecurringExpenses(
  tenantId: string,
  includeInactive?: boolean,
): Promise<RecurringExpense[]> {
  const qs = new URLSearchParams();
  if (includeInactive) qs.append('includeInactive', 'true');

  const queryStr = qs.toString();
  return apiClient<RecurringExpense[]>({
    path: `/tenants/${tenantId}/recurring-expenses${queryStr ? '?' + queryStr : ''}`,
    method: 'GET',
  });
}

export async function createTenantRecurringExpense(
  tenantId: string,
  data: CreateTenantRecurringExpenseData,
): Promise<RecurringExpense> {
  return apiClient<RecurringExpense, CreateTenantRecurringExpenseData>({
    path: `/tenants/${tenantId}/recurring-expenses`,
    method: 'POST',
    body: data,
  });
}

export async function updateTenantRecurringExpense(
  tenantId: string,
  recurringExpenseId: string,
  data: UpdateRecurringExpenseData,
): Promise<RecurringExpense> {
  return apiClient<RecurringExpense, UpdateRecurringExpenseData>({
    path: `/tenants/${tenantId}/recurring-expenses/${recurringExpenseId}`,
    method: 'PATCH',
    body: data,
  });
}

// ── Liquidations API ───────────────────────────────────────────────────────

export async function listLiquidations(
  tenantId: string,
  params: { buildingId?: string; period?: string } = {},
): Promise<Liquidation[]> {
  const qs = new URLSearchParams();
  if (params.buildingId) qs.append('buildingId', params.buildingId);
  if (params.period) qs.append('period', params.period);

  const queryStr = qs.toString();
  const liquidations = await apiClient<Liquidation[]>({
    path: `/tenants/${tenantId}/finance/liquidations${queryStr ? '?' + queryStr : ''}`,
    method: 'GET',
  });
  liquidations.forEach(assertLiquidationV3Summary);
  return liquidations;
}

export async function getLiquidation(
  tenantId: string,
  liquidationId: string,
): Promise<LiquidationDetail> {
  const liquidation = await apiClient<LiquidationDetail>({
    path: `/tenants/${tenantId}/finance/liquidations/${liquidationId}`,
    method: 'GET',
  });
  assertLiquidationV3Summary(liquidation);
  return liquidation;
}

export async function createLiquidationDraft(
  tenantId: string,
  data: { buildingId: string; period: string; baseCurrency: string },
): Promise<LiquidationDetail> {
  return apiClient<LiquidationDetail, typeof data>({
    path: `/tenants/${tenantId}/finance/liquidations/draft`,
    method: 'POST',
    body: data,
  });
}

export async function reviewLiquidation(
  tenantId: string,
  liquidationId: string,
): Promise<Liquidation> {
  return apiClient<Liquidation>({
    path: `/tenants/${tenantId}/finance/liquidations/${liquidationId}/review`,
    method: 'POST',
  });
}

export async function publishLiquidation(
  tenantId: string,
  liquidationId: string,
  data: { dueDate: string },
): Promise<Liquidation> {
  return apiClient<Liquidation, typeof data>({
    path: `/tenants/${tenantId}/finance/liquidations/${liquidationId}/publish`,
    method: 'POST',
    body: data,
  });
}

export async function cancelLiquidation(
  tenantId: string,
  liquidationId: string,
): Promise<Liquidation> {
  return apiClient<Liquidation>({
    path: `/tenants/${tenantId}/finance/liquidations/${liquidationId}/cancel`,
    method: 'POST',
  });
}

// ── Incomes API ────────────────────────────────────────────────────────────

export interface ListIncomesParams {
  buildingId?: string;
  period?: string;
  categoryId?: string;
}

export async function listIncomes(
  tenantId: string,
  params: ListIncomesParams = {},
): Promise<Income[]> {
  const qs = new URLSearchParams();
  if (params.buildingId) qs.append('buildingId', params.buildingId);
  if (params.period) qs.append('period', params.period);
  if (params.categoryId) qs.append('categoryId', params.categoryId);

  const queryStr = qs.toString();
  return apiClient<Income[]>({
    path: `/tenants/${tenantId}/finance/incomes${queryStr ? '?' + queryStr : ''}`,
    method: 'GET',
  });
}

export async function getIncome(tenantId: string, incomeId: string): Promise<Income> {
  return apiClient<Income>({
    path: `/tenants/${tenantId}/finance/incomes/${incomeId}`,
    method: 'GET',
  });
}

export interface CreateIncomeData {
  buildingId?: string;
  period: string;
  categoryId: string;
  amountMinor: number;
  currencyCode: string;
  receivedDate: string;
  description?: string;
  attachmentFileKey?: string;
  // FIN-07A: scope/allocations según backend (FIN-04)
  scopeType?: 'BUILDING' | 'TENANT_SHARED' | 'UNIT_GROUP';
  destination?: 'APPLY_TO_EXPENSES' | 'RESERVE_FUND' | 'SPECIAL_FUND';
  unitGroupId?: string;
  allocations?: Array<{ buildingId: string; amountMinor?: number; percentage?: number }>;
}

export async function createIncome(
  tenantId: string,
  data: CreateIncomeData,
): Promise<Income> {
  return apiClient<Income, CreateIncomeData>({
    path: `/tenants/${tenantId}/finance/incomes`,
    method: 'POST',
    body: data,
  });
}

export async function updateIncome(
  tenantId: string,
  incomeId: string,
  data: Partial<CreateIncomeData>,
): Promise<Income> {
  return apiClient<Income, Partial<CreateIncomeData>>({
    path: `/tenants/${tenantId}/finance/incomes/${incomeId}`,
    method: 'PATCH',
    body: data,
  });
}

export async function recordIncome(
  tenantId: string,
  incomeId: string,
): Promise<Income> {
  return apiClient<Income>({
    path: `/tenants/${tenantId}/finance/incomes/${incomeId}/record`,
    method: 'POST',
  });
}

export async function voidIncome(
  tenantId: string,
  incomeId: string,
): Promise<Income> {
  return apiClient<Income>({
    path: `/tenants/${tenantId}/finance/incomes/${incomeId}/void`,
    method: 'POST',
  });
}

export async function getAllocationSuggestions(
  tenantId: string,
  mode: 'BUILDING_TOTAL_M2' | 'EQUAL_SHARE' = 'BUILDING_TOTAL_M2',
): Promise<AllocationSuggestion[]> {
  const qs = new URLSearchParams();
  if (mode) qs.append('mode', mode);

  return apiClient<AllocationSuggestion[]>({
    path: `/tenants/${tenantId}/allocations/suggest?${qs.toString()}`,
    method: 'GET',
  });
}

// ── Vendor Preferences ───────────────────────────────────────────────────

export interface VendorPreference {
  id: string;
  categoryId: string;
  categoryName: string;
  vendorId: string;
  vendorName: string;
}

export interface VendorSuggestion {
  vendorId: string | null;
  vendorName: string | null;
  source: 'PREFERENCE' | 'HISTORY' | 'NONE';
}

export async function listVendorPreferences(tenantId: string): Promise<VendorPreference[]> {
  return apiClient<VendorPreference[]>({
    path: `/tenants/${tenantId}/finance/vendor-preferences`,
    method: 'GET',
  });
}

export async function setVendorPreference(
  tenantId: string,
  categoryId: string,
  vendorId: string,
): Promise<VendorPreference> {
  return apiClient<VendorPreference, { categoryId: string; vendorId: string }>({
    path: `/tenants/${tenantId}/finance/vendor-preferences`,
    method: 'POST',
    body: { categoryId, vendorId },
  });
}

export async function deleteVendorPreference(
  tenantId: string,
  categoryId: string,
): Promise<{ success: boolean }> {
  return apiClient<{ success: boolean }>({
    path: `/tenants/${tenantId}/finance/vendor-preferences/${categoryId}`,
    method: 'DELETE',
  });
}

export async function getVendorSuggestion(
  tenantId: string,
  categoryId: string,
): Promise<VendorSuggestion> {
  return apiClient<VendorSuggestion>({
    path: `/tenants/${tenantId}/finance/vendor-preferences/suggest/${categoryId}`,
    method: 'GET',
  });
}

// ── Expense Reports ───────────────────────────────────────────────────────

export interface CurrencyAmountBucket {
  readonly currency: string;
  readonly amountMinor: number;
}

export interface BuildingPeriodSummary {
  buildingId: string;
  buildingName: string;
  buildingExpensesByCurrency: CurrencyAmountBucket[];
  sharedPortionByCurrency: CurrencyAmountBucket[];
  totalByCurrency: CurrencyAmountBucket[];
}

export interface ExpensePeriodReport {
  period: string;
  totalTenantByCurrency: CurrencyAmountBucket[];
  sharedTotalByCurrency: CurrencyAmountBucket[];
  byBuilding: BuildingPeriodSummary[];
}

export async function listExpenseReports(tenantId: string): Promise<ExpensePeriodReport[]> {
  return apiClient<ExpensePeriodReport[]>({
    path: `/tenants/${tenantId}/finance/reports/expenses`,
    method: 'GET',
  });
}

// ── Notas Revelatorias ────────────────────────────────────────────────────

export interface IncomeEntry {
  description: string;
  currencyCode: string;
  amountMinor: number;
}

export interface BuildingIncomeSection {
  buildingId: string;
  buildingName: string;
  entries: IncomeEntry[];
  totalByCurrency: CurrencyAmountBucket[];
}

export interface ExpenseLineItem {
  itemNumber: number;
  date: string;
  description: string;
  amountByCurrency: CurrencyAmountBucket[];
}

export interface BuildingExpenseSection {
  buildingId: string;
  buildingName: string;
  items: ExpenseLineItem[];
  totalByCurrency: CurrencyAmountBucket[];
}

export interface AlicuotaRow {
  categoryName: string;
  coefficient: number;
  gastosComunesPerUnit: number;
  gastosPropiosPerUnit: number;
  reservaPerUnit: number;
  totalPerUnit: number;
  unitCount: number;
  totalToRecaudar: number;
}

export interface BuildingAlicuota {
  buildingId: string;
  buildingName: string;
  rows: AlicuotaRow[];
  grandTotal: number;
  baseCurrency: 'USD';
}

export interface NotasRevelatoriasReport {
  tenantId: string;
  tenantName: string;
  period: string;
  periodLabel: string;
  buildingIncomes: BuildingIncomeSection[];
  commonExpenses: ExpenseLineItem[];
  commonTotals: { byCurrency: CurrencyAmountBucket[] };
  buildingExpenses: BuildingExpenseSection[];
  reservaLegal: { buildingName: string; byCurrency: CurrencyAmountBucket[] }[];
  alicuotas: BuildingAlicuota[];
}

export async function getNotasRevelatorias(
  tenantId: string,
  period: string,
): Promise<NotasRevelatoriasReport> {
  return apiClient<NotasRevelatoriasReport>({
    path: `/tenants/${tenantId}/finance/reports/notas-revelatorias?period=${period}`,
    method: 'GET',
  });
}

// ── Adjustments / Retroactivos ─────────────────────────────────────────────

export type AdjustmentStatus = 'DRAFT' | 'VALIDATED' | 'VOIDED';

export interface Adjustment {
  id: string;
  tenantId: string;
  buildingId: string;
  buildingName: string;
  sourceInvoiceDate: string;
  sourcePeriod: string;
  targetPeriod: string;
  categoryId: string;
  amountMinor: number;
  currencyCode: string;
  reason: string;
  status: AdjustmentStatus;
  createdByMembershipId: string;
  validatedByMembershipId: string | null;
  validatedAt: string | null;
  functionalAmountMinor?: number | null;
  functionalCurrencyCode?: string | null;
  exchangeRateId?: string | null;
  exchangeRateValue?: string | null;
  exchangeRateDirection?: string | null;
  exchangeRateEffectiveAt?: string | null;
  conversionDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAdjustmentData {
  buildingId: string;
  sourceInvoiceDate: string;
  sourcePeriod: string;
  targetPeriod: string;
  categoryId: string;
  amountMinor: number;
  currencyCode: string;
  reason: string;
}

export async function createAdjustment(
  tenantId: string,
  data: CreateAdjustmentData,
): Promise<Adjustment> {
  return apiClient<Adjustment, CreateAdjustmentData>({
    path: `/tenants/${tenantId}/finance/adjustments`,
    method: 'POST',
    body: data,
  });
}

export async function validateAdjustment(
  tenantId: string,
  adjustmentId: string,
): Promise<Adjustment> {
  return apiClient<Adjustment>({
    path: `/tenants/${tenantId}/finance/adjustments/${adjustmentId}/validate`,
    method: 'POST',
  });
}

export interface ListAdjustmentsParams {
  buildingId?: string;
  targetPeriod?: string;
  status?: AdjustmentStatus;
}

export async function listAdjustments(
  tenantId: string,
  params?: ListAdjustmentsParams,
): Promise<Adjustment[]> {
  const query = new URLSearchParams();
  if (params?.buildingId) query.set('buildingId', params.buildingId);
  if (params?.targetPeriod) query.set('targetPeriod', params.targetPeriod);
  if (params?.status) query.set('status', params.status);
  return apiClient<Adjustment[]>({
    path: `/tenants/${tenantId}/finance/adjustments?${query.toString()}`,
    method: 'GET',
  });
}
