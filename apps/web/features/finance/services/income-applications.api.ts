/**
 * FIN-07A: API client para IncomeApplications (FIN-03/05/04).
 * Endpoints: /tenants/:tenantId/finance/incomes/:incomeId/applications
 */

import { apiClient } from '@/shared/lib/http/client';
import { parseIncomeApplicationPlan } from '../contracts/finance-guards';
import type {
  CreateIncomeApplicationPlanData,
  IncomeApplicationPlan,
} from '../contracts/finance-types';

export function getIncomeApplicationPlan(
  tenantId: string,
  incomeId: string,
): Promise<IncomeApplicationPlan> {
  return apiClient<unknown>({
    path: `/tenants/${tenantId}/finance/incomes/${incomeId}/applications`,
    method: 'GET',
  }).then(parseIncomeApplicationPlan);
}

export function createIncomeApplicationPlan(
  tenantId: string,
  incomeId: string,
  data: CreateIncomeApplicationPlanData,
): Promise<IncomeApplicationPlan> {
  return apiClient<unknown, CreateIncomeApplicationPlanData>({
    path: `/tenants/${tenantId}/finance/incomes/${incomeId}/applications`,
    method: 'POST',
    body: data,
  }).then(parseIncomeApplicationPlan);
}

export function applyIncomePolicy(
  tenantId: string,
  incomeId: string,
): Promise<IncomeApplicationPlan> {
  return apiClient<unknown>({
    path: `/tenants/${tenantId}/finance/incomes/${incomeId}/apply-policy`,
    method: 'POST',
  }).then(parseIncomeApplicationPlan);
}
