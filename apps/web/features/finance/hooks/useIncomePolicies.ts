import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateIncomePolicyData, CreateIncomePolicyVersionData } from '../contracts';
import {
  createIncomePolicy,
  createIncomePolicyVersion,
  deactivateIncomePolicy,
  getIncomePolicy,
  listIncomePolicies,
} from '../services/income-policies.api';
import { financeKeyFamilies, financeKeys } from './finance-query-keys';

export function useIncomePolicies(tenantId: string) {
  return useQuery({
    queryKey: financeKeys.incomePolicies(tenantId),
    queryFn: () => listIncomePolicies(tenantId),
    enabled: Boolean(tenantId),
    staleTime: 30 * 1000,
  });
}

export function useIncomePolicy(tenantId: string, categoryId: string) {
  return useQuery({
    queryKey: financeKeys.incomePolicy(tenantId, categoryId),
    queryFn: () => getIncomePolicy(tenantId, categoryId),
    enabled: Boolean(tenantId && categoryId),
    staleTime: 30 * 1000,
  });
}

function invalidatePolicies(queryClient: ReturnType<typeof useQueryClient>, tenantId: string, categoryId: string) {
  void queryClient.invalidateQueries({ queryKey: financeKeyFamilies.incomePolicies(tenantId) });
  void queryClient.invalidateQueries({ queryKey: financeKeys.incomePolicy(tenantId, categoryId) });
}

export function useCreateIncomePolicy(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateIncomePolicyData) => createIncomePolicy(tenantId, data),
    onSuccess: (policy) => invalidatePolicies(queryClient, tenantId, policy.categoryId),
  });
}

export function useCreateIncomePolicyVersion(tenantId: string, categoryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateIncomePolicyVersionData) =>
      createIncomePolicyVersion(tenantId, categoryId, data),
    onSuccess: () => invalidatePolicies(queryClient, tenantId, categoryId),
  });
}

export function useDeactivateIncomePolicy(tenantId: string, categoryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deactivateIncomePolicy(tenantId, categoryId),
    onSuccess: () => invalidatePolicies(queryClient, tenantId, categoryId),
  });
}
