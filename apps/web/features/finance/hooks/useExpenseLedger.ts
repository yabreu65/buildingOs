import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listExpenseLedgerCategories,
  createExpenseLedgerCategory,
  updateExpenseLedgerCategory,
  deleteExpenseLedgerCategory,
  listExpenses,
  createExpense,
  updateExpense,
  validateExpense,
  voidExpense,
  listIncomes,
  createIncome,
  updateIncome,
  recordIncome,
  voidIncome,
  listLiquidations,
  getLiquidation,
  createLiquidationDraft,
  reviewLiquidation,
  publishLiquidation,
  cancelLiquidation,
  listExpenseReports,
  getNotasRevelatorias,
  ListExpensesParams,
  CreateExpenseData,
  ListIncomesParams,
  CreateIncomeData,
} from '../services/expense-ledger.api';

// ── ExpenseLedgerCategories hooks ──────────────────────────────────────────

export function useExpenseLedgerCategories(
  tenantId: string,
  movementType?: 'EXPENSE' | 'INCOME',
  catalogScope?: 'BUILDING' | 'CONDOMINIUM_COMMON',
) {
  return useQuery({
    queryKey: ['expenseLedgerCategories', tenantId, movementType, catalogScope],
    queryFn: () => listExpenseLedgerCategories(tenantId, movementType, catalogScope),
    staleTime: 10 * 60 * 1000,
    enabled: !!tenantId,
    placeholderData: (prev) => prev ?? [],
  });
}

export function useCreateExpenseLedgerCategory(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      description?: string;
      movementType?: 'EXPENSE' | 'INCOME';
      catalogScope?: 'BUILDING' | 'CONDOMINIUM_COMMON';
    }) => createExpenseLedgerCategory(tenantId, data),
    onSuccess: (_, variables) => {
      // Invalidate both all categories and the specific movement type
      void queryClient.invalidateQueries({
        queryKey: ['expenseLedgerCategories', tenantId],
      });
    },
  });
}

export function useUpdateExpenseLedgerCategory(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      categoryId,
      data,
    }: {
      categoryId: string;
      data: { name?: string; description?: string; isActive?: boolean };
    }) => updateExpenseLedgerCategory(tenantId, categoryId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['expenseLedgerCategories', tenantId],
      });
    },
  });
}

export function useDeleteExpenseLedgerCategory(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) =>
      deleteExpenseLedgerCategory(tenantId, categoryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['expenseLedgerCategories', tenantId],
      });
    },
  });
}

// ── Expenses hooks ─────────────────────────────────────────────────────────

export function useExpenses(tenantId: string, params: ListExpensesParams = {}) {
  return useQuery({
    queryKey: ['expenses', tenantId, params],
    queryFn: () => listExpenses(tenantId, params),
    staleTime: 2 * 60 * 1000,
    enabled: !!tenantId,
    placeholderData: (prev) => prev ?? [],
  });
}

export function useCreateExpense(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateExpenseData) => createExpense(tenantId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses', tenantId] });
    },
  });
}

export function useUpdateExpense(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      expenseId,
      data,
    }: {
      expenseId: string;
      data: Partial<CreateExpenseData>;
    }) => updateExpense(tenantId, expenseId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses', tenantId] });
    },
  });
}

export function useValidateExpense(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (expenseId: string) => validateExpense(tenantId, expenseId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses', tenantId] });
    },
  });
}

export function useVoidExpense(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (expenseId: string) => voidExpense(tenantId, expenseId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses', tenantId] });
    },
  });
}

// ── Liquidations hooks ─────────────────────────────────────────────────────

export function useLiquidations(
  tenantId: string,
  params: { buildingId?: string; period?: string } = {},
) {
  return useQuery({
    queryKey: ['liquidations', tenantId, params],
    queryFn: () => listLiquidations(tenantId, params),
    staleTime: 2 * 60 * 1000,
    enabled: !!tenantId,
    placeholderData: (prev) => prev ?? [],
  });
}

export function useLiquidationDetail(tenantId: string, liquidationId: string) {
  return useQuery({
    queryKey: ['liquidation', tenantId, liquidationId],
    queryFn: () => getLiquidation(tenantId, liquidationId),
    staleTime: 2 * 60 * 1000,
    enabled: !!tenantId && !!liquidationId,
  });
}

export function useCreateLiquidationDraft(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { buildingId: string; period: string; baseCurrency: string }) =>
      createLiquidationDraft(tenantId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['liquidations', tenantId] });
    },
  });
}

export function useReviewLiquidation(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (liquidationId: string) => reviewLiquidation(tenantId, liquidationId),
    onSuccess: (_, liquidationId) => {
      void queryClient.invalidateQueries({ queryKey: ['liquidations', tenantId] });
      void queryClient.invalidateQueries({
        queryKey: ['liquidation', tenantId, liquidationId],
      });
    },
  });
}

export function usePublishLiquidation(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      liquidationId,
      dueDate,
    }: {
      liquidationId: string;
      dueDate: string;
    }) => publishLiquidation(tenantId, liquidationId, { dueDate }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['liquidations', tenantId] });
      // También invalidar charges ya que se crearon nuevos
      void queryClient.invalidateQueries({ queryKey: ['charges'] });
    },
  });
}

export function useCancelLiquidation(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (liquidationId: string) => cancelLiquidation(tenantId, liquidationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['liquidations', tenantId] });
      void queryClient.invalidateQueries({ queryKey: ['charges'] });
    },
  });
}

// ── Incomes hooks ─────────────────────────────────────────────────────────

export function useIncomes(tenantId: string, params: ListIncomesParams = {}) {
  return useQuery({
    queryKey: ['incomes', tenantId, params],
    queryFn: () => listIncomes(tenantId, params),
    staleTime: 2 * 60 * 1000,
    enabled: !!tenantId,
    placeholderData: (prev) => prev ?? [],
  });
}

export function useCreateIncome(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateIncomeData) => createIncome(tenantId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['incomes', tenantId] });
    },
  });
}

export function useUpdateIncome(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      incomeId,
      data,
    }: {
      incomeId: string;
      data: Partial<CreateIncomeData>;
    }) => updateIncome(tenantId, incomeId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['incomes', tenantId] });
    },
  });
}

export function useRecordIncome(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (incomeId: string) => recordIncome(tenantId, incomeId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['incomes', tenantId] });
    },
  });
}

export function useVoidIncome(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (incomeId: string) => voidIncome(tenantId, incomeId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['incomes', tenantId] });
    },
  });
}

// ── Expense Reports hook ───────────────────────────────────────────────────

export function useExpenseReports(tenantId: string) {
  return useQuery({
    queryKey: ['expense-reports', tenantId],
    queryFn: () => listExpenseReports(tenantId),
    staleTime: 5 * 60 * 1000,
    enabled: !!tenantId,
  });
}

export function useNotasRevelatorias(tenantId: string, period: string) {
  return useQuery({
    queryKey: ['notas-revelatorias', tenantId, period],
    queryFn: () => getNotasRevelatorias(tenantId, period),
    staleTime: 5 * 60 * 1000,
    enabled: !!tenantId && !!period,
  });
}
