import { apiClient } from '@/shared/lib/http/client';

// ── Types ──────────────────────────────────────────────────────────────────

export type ExpenseStatus = 'DRAFT' | 'VALIDATED' | 'VOID';
export type LiquidationStatus = 'DRAFT' | 'REVIEWED' | 'PUBLISHED' | 'CANCELED';

export interface ExpenseLedgerCategory {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  active: boolean;
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
): Promise<ExpenseLedgerCategory[]> {
  return apiClient<ExpenseLedgerCategory[]>({
    path: `/tenants/${tenantId}/finance/expense-categories`,
    method: 'GET',
  });
}

export async function createExpenseLedgerCategory(
  tenantId: string,
  data: { name: string; description?: string },
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
  data: { name?: string; description?: string; active?: boolean },
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

export interface ListExpensesParams {
  buildingId?: string;
  period?: string;
  status?: ExpenseStatus;
  categoryId?: string;
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

export interface CreateExpenseData {
  buildingId: string;
  period: string;
  categoryId: string;
  vendorId?: string;
  amountMinor: number;
  currencyCode: string;
  invoiceDate: string;
  description?: string;
  attachmentFileKey?: string;
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
