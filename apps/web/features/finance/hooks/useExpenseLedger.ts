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
  listLiquidations,
  getLiquidation,
  createLiquidationDraft,
  reviewLiquidation,
  publishLiquidation,
  cancelLiquidation,
  ListExpensesParams,
  CreateExpenseData,
} from '../services/expense-ledger.api';

// ── ExpenseLedgerCategories hooks ──────────────────────────────────────────

export function useExpenseLedgerCategories(tenantId: string) {
  return useQuery({
    queryKey: ['expenseLedgerCategories', tenantId],
    queryFn: () => listExpenseLedgerCategories(tenantId),
    staleTime: 10 * 60 * 1000,
    enabled: !!tenantId,
    placeholderData: (prev) => prev ?? [],
  });
}

export function useCreateExpenseLedgerCategory(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      createExpenseLedgerCategory(tenantId, data),
    onSuccess: () => {
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
      data: { name?: string; description?: string; active?: boolean };
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
