import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateIncomeApplicationPlanData } from '../contracts';
import {
  applyIncomePolicy,
  createIncomeApplicationPlan,
  getIncomeApplicationPlan,
} from '../services/income-applications.api';
import { financeKeyFamilies, financeKeys } from './finance-query-keys';

export function useIncomeApplicationPlan(tenantId: string, incomeId: string) {
  return useQuery({
    queryKey: financeKeys.incomeApplications(tenantId, incomeId),
    queryFn: () => getIncomeApplicationPlan(tenantId, incomeId),
    enabled: Boolean(tenantId && incomeId),
    staleTime: 30 * 1000,
  });
}

export function useCreateIncomeApplicationPlan(tenantId: string, incomeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateIncomeApplicationPlanData) =>
      createIncomeApplicationPlan(tenantId, incomeId, data),
    onSuccess: (plan) => {
      void queryClient.invalidateQueries({
        queryKey: financeKeys.incomeApplications(tenantId, incomeId),
      });
      void queryClient.invalidateQueries({ queryKey: financeKeyFamilies.incomes(tenantId) });
      void queryClient.invalidateQueries({ queryKey: financeKeyFamilies.liquidations(tenantId) });
      void queryClient.invalidateQueries({ queryKey: financeKeyFamilies.legacyBackfill(tenantId) });
      if (plan.applications.some((application) => application.destinationType === 'FUND')) {
        void queryClient.invalidateQueries({ queryKey: financeKeyFamilies.funds(tenantId) });
      }
    },
  });
}

export function useApplyIncomePolicy(tenantId: string, incomeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => applyIncomePolicy(tenantId, incomeId),
    onSuccess: (plan) => {
      void queryClient.invalidateQueries({
        queryKey: financeKeys.incomeApplications(tenantId, incomeId),
      });
      void queryClient.invalidateQueries({ queryKey: financeKeyFamilies.incomes(tenantId) });
      void queryClient.invalidateQueries({ queryKey: financeKeyFamilies.liquidations(tenantId) });
      void queryClient.invalidateQueries({ queryKey: financeKeyFamilies.legacyBackfill(tenantId) });
      if (plan.applications.some((application) => application.destinationType === 'FUND')) {
        void queryClient.invalidateQueries({ queryKey: financeKeyFamilies.funds(tenantId) });
      }
    },
  });
}
