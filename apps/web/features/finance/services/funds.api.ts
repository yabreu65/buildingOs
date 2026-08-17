/**
 * FIN-07A: API client para Funds / FundTransactions (FIN-02).
 * Endpoints: /tenants/:tenantId/finance/funds
 */

import { apiClient } from '@/shared/lib/http/client';
import {
  parseFund,
  parseFunds,
  parseFundTransaction,
  parseFundTransactions,
} from '../contracts/finance-guards';
import type {
  CreateFundData,
  CreateFundTransactionData,
  Fund,
  FundTransaction,
  FundTransactionQuery,
  FundQuery,
  ReverseFundTransactionData,
  UpdateFundData,
} from '../contracts/finance-types';

export function listFunds(tenantId: string, query: FundQuery = {}): Promise<Fund[]> {
  const searchParams = new URLSearchParams();
  if (query.buildingId) searchParams.set('buildingId', query.buildingId);
  if (query.scopeType) searchParams.set('scopeType', query.scopeType);
  if (query.status) searchParams.set('status', query.status);
  const qs = searchParams.toString();
  return apiClient<unknown>({
    path: `/tenants/${tenantId}/finance/funds${qs ? `?${qs}` : ''}`,
    method: 'GET',
  }).then(parseFunds);
}

export function getFund(tenantId: string, fundId: string): Promise<Fund> {
  return apiClient<unknown>({
    path: `/tenants/${tenantId}/finance/funds/${fundId}`,
    method: 'GET',
  }).then(parseFund);
}

export function createFund(tenantId: string, data: CreateFundData): Promise<Fund> {
  return apiClient<unknown, CreateFundData>({
    path: `/tenants/${tenantId}/finance/funds`,
    method: 'POST',
    body: data,
  }).then(parseFund);
}

export function updateFund(
  tenantId: string,
  fundId: string,
  data: UpdateFundData,
): Promise<Fund> {
  return apiClient<unknown, UpdateFundData>({
    path: `/tenants/${tenantId}/finance/funds/${fundId}`,
    method: 'PATCH',
    body: data,
  }).then(parseFund);
}

export function archiveFund(tenantId: string, fundId: string): Promise<Fund> {
  return apiClient<unknown>({
    path: `/tenants/${tenantId}/finance/funds/${fundId}/archive`,
    method: 'POST',
  }).then(parseFund);
}

export function listFundTransactions(
  tenantId: string,
  fundId: string,
  query: FundTransactionQuery = {},
): Promise<FundTransaction[]> {
  const searchParams = new URLSearchParams();
  if (query.currencyCode) searchParams.set('currencyCode', query.currencyCode);
  if (query.limit !== undefined) searchParams.set('limit', String(query.limit));
  if (query.offset !== undefined) searchParams.set('offset', String(query.offset));
  const qs = searchParams.toString();
  return apiClient<unknown>({
    path: `/tenants/${tenantId}/finance/funds/${fundId}/transactions${qs ? `?${qs}` : ''}`,
    method: 'GET',
  }).then(parseFundTransactions);
}

export function createFundTransaction(
  tenantId: string,
  fundId: string,
  data: CreateFundTransactionData,
): Promise<FundTransaction> {
  return apiClient<unknown, CreateFundTransactionData>({
    path: `/tenants/${tenantId}/finance/funds/${fundId}/transactions`,
    method: 'POST',
    body: data,
  }).then(parseFundTransaction);
}

export function reverseFundTransaction(
  tenantId: string,
  fundId: string,
  transactionId: string,
  data: ReverseFundTransactionData = {},
): Promise<FundTransaction> {
  return apiClient<unknown, ReverseFundTransactionData>({
    path: `/tenants/${tenantId}/finance/funds/${fundId}/transactions/${transactionId}/reverse`,
    method: 'POST',
    body: data,
  }).then(parseFundTransaction);
}
