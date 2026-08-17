import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  archiveFund,
  createFund,
  createFundTransaction,
  getFund,
  listFunds,
  listFundTransactions,
  reverseFundTransaction,
  updateFund,
} from '../services/funds.api';
import type {
  CreateFundData,
  CreateFundTransactionData,
  FundQuery,
  FundTransactionQuery,
  ReverseFundTransactionData,
  UpdateFundData,
} from '../contracts/finance-types';
import { financeKeyFamilies, financeKeys } from './finance-query-keys';

export function useFunds(tenantId: string, query: FundQuery = {}) {
  return useQuery({
    queryKey: financeKeys.funds(tenantId, query),
    queryFn: () => listFunds(tenantId, query),
    enabled: !!tenantId,
    staleTime: 30 * 1000,
  });
}

export function useFund(tenantId: string, fundId: string) {
  return useQuery({
    queryKey: financeKeys.fund(tenantId, fundId),
    queryFn: () => getFund(tenantId, fundId),
    enabled: !!tenantId && !!fundId,
    staleTime: 30 * 1000,
  });
}

export function useFundTransactions(
  tenantId: string,
  fundId: string,
  query: FundTransactionQuery = {},
) {
  return useQuery({
    queryKey: financeKeys.fundTransactions(tenantId, fundId, query),
    queryFn: () => listFundTransactions(tenantId, fundId, query),
    enabled: !!tenantId && !!fundId,
    staleTime: 30 * 1000,
  });
}

export function useCreateFund(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateFundData) => createFund(tenantId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeKeyFamilies.funds(tenantId) });
    },
  });
}

export function useUpdateFund(tenantId: string, fundId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateFundData) => updateFund(tenantId, fundId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeKeyFamilies.funds(tenantId) });
      void queryClient.invalidateQueries({ queryKey: financeKeys.fund(tenantId, fundId) });
    },
  });
}

export function useArchiveFund(tenantId: string, fundId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => archiveFund(tenantId, fundId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeKeyFamilies.funds(tenantId) });
      void queryClient.invalidateQueries({ queryKey: financeKeys.fund(tenantId, fundId) });
    },
  });
}

export function useCreateFundTransaction(tenantId: string, fundId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateFundTransactionData) =>
      createFundTransaction(tenantId, fundId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.fund(tenantId, fundId) });
      void queryClient.invalidateQueries({
        queryKey: financeKeys.fundTransactions(tenantId, fundId),
      });
    },
  });
}

export function useReverseFundTransaction(tenantId: string, fundId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ transactionId, data }: { transactionId: string; data?: ReverseFundTransactionData }) =>
      reverseFundTransaction(tenantId, fundId, transactionId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.fund(tenantId, fundId) });
      void queryClient.invalidateQueries({
        queryKey: financeKeys.fundTransactions(tenantId, fundId),
      });
    },
  });
}
