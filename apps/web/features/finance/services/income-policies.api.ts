/**
 * FIN-07A: API client para IncomePolicies (FIN-05).
 * Endpoints: /tenants/:tenantId/finance/income-policies
 */

import { apiClient } from '@/shared/lib/http/client';
import { parseIncomePolicies, parseIncomePolicy } from '../contracts/finance-guards';
import type {
  CreateIncomePolicyData,
  CreateIncomePolicyVersionData,
  IncomePolicy,
} from '../contracts/finance-types';

export function listIncomePolicies(tenantId: string): Promise<IncomePolicy[]> {
  return apiClient<unknown>({
    path: `/tenants/${tenantId}/finance/income-policies`,
    method: 'GET',
  }).then(parseIncomePolicies);
}

export function getIncomePolicy(
  tenantId: string,
  categoryId: string,
): Promise<IncomePolicy> {
  return apiClient<unknown>({
    path: `/tenants/${tenantId}/finance/income-policies/${categoryId}`,
    method: 'GET',
  }).then(parseIncomePolicy);
}

export function createIncomePolicy(
  tenantId: string,
  data: CreateIncomePolicyData,
): Promise<IncomePolicy> {
  return apiClient<unknown, CreateIncomePolicyData>({
    path: `/tenants/${tenantId}/finance/income-policies`,
    method: 'POST',
    body: data,
  }).then(parseIncomePolicy);
}

export function createIncomePolicyVersion(
  tenantId: string,
  categoryId: string,
  data: CreateIncomePolicyVersionData,
): Promise<IncomePolicy> {
  return apiClient<unknown, CreateIncomePolicyVersionData>({
    path: `/tenants/${tenantId}/finance/income-policies/${categoryId}/versions`,
    method: 'POST',
    body: data,
  }).then(parseIncomePolicy);
}

export function deactivateIncomePolicy(
  tenantId: string,
  categoryId: string,
): Promise<IncomePolicy> {
  return apiClient<unknown>({
    path: `/tenants/${tenantId}/finance/income-policies/${categoryId}/deactivate`,
    method: 'POST',
  }).then(parseIncomePolicy);
}
