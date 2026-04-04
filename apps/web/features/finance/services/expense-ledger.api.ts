import { apiClient } from '@/shared/lib/http/client';

// ── Types ──────────────────────────────────────────────────────────────────

export type ExpenseStatus = 'DRAFT' | 'VALIDATED' | 'VOID';
export type IncomeStatus = 'DRAFT' | 'RECORDED' | 'VOID';
export type LiquidationStatus = 'DRAFT' | 'REVIEWED' | 'PUBLISHED' | 'CANCELED';
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
  buildingId: string;
  period: string;
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
  expenses: LiquidationExpenseItem[];
  chargesPreview: LiquidationChargePreview[];
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

// ── Liquidations API ───────────────────────────────────────────────────────

export async function listLiquidations(
  tenantId: string,
  params: { buildingId?: string; period?: string } = {},
): Promise<Liquidation[]> {
  const qs = new URLSearchParams();
  if (params.buildingId) qs.append('buildingId', params.buildingId);
  if (params.period) qs.append('period', params.period);

  const queryStr = qs.toString();
  return apiClient<Liquidation[]>({
    path: `/tenants/${tenantId}/finance/liquidations${queryStr ? '?' + queryStr : ''}`,
    method: 'GET',
  });
}

export async function getLiquidation(
  tenantId: string,
  liquidationId: string,
): Promise<LiquidationDetail> {
  return apiClient<LiquidationDetail>({
    path: `/tenants/${tenantId}/finance/liquidations/${liquidationId}`,
    method: 'GET',
  });
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

export interface BuildingPeriodSummary {
  buildingId: string;
  buildingName: string;
  buildingExpenses: number;
  sharedPortion: number;
  total: number;
}

export interface ExpensePeriodReport {
  period: string;
  totalTenant: number;
  sharedTotal: number;
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
  totalUSD: number;
  totalVES: number;
  totalPesos: number;
}

export interface ExpenseLineItem {
  itemNumber: number;
  date: string;
  description: string;
  usdAmount: number;
  vesAmount: number;
  pesosAmount: number;
}

export interface BuildingExpenseSection {
  buildingId: string;
  buildingName: string;
  items: ExpenseLineItem[];
  totalUSD: number;
  totalVES: number;
  totalPesos: number;
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
}

export interface NotasRevelatoriasReport {
  tenantId: string;
  tenantName: string;
  period: string;
  periodLabel: string;
  buildingIncomes: BuildingIncomeSection[];
  commonExpenses: ExpenseLineItem[];
  commonTotals: { usd: number; ves: number; pesos: number };
  buildingExpenses: BuildingExpenseSection[];
  reservaLegal: { buildingName: string; usd: number; ves: number }[];
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
