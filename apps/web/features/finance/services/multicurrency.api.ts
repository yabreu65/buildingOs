import type { CanonicalCurrency } from '@buildingos/contracts';
import { apiClient } from '@/shared/lib/http/client';

export interface FinanceSettings { readonly functionalCurrency: CanonicalCurrency }
export interface ExchangeRate {
  readonly id: string;
  readonly baseCurrency: CanonicalCurrency;
  readonly quoteCurrency: CanonicalCurrency;
  readonly rate: string;
  readonly effectiveAt: string;
  readonly source: string | null;
}
export interface ExchangeRateInput {
  readonly baseCurrency: CanonicalCurrency;
  readonly quoteCurrency: CanonicalCurrency;
  readonly rate: string;
  readonly effectiveAt: string;
  readonly source?: string;
}
export interface ExchangeRateUpdateInput {
  readonly rate: string;
  readonly effectiveAt: string;
  readonly source?: string;
}

export const getFinanceSettings = (tenantId: string) => apiClient<FinanceSettings>({ path: `/tenants/${tenantId}/finance/settings` });
export const updateFinanceSettings = (tenantId: string, functionalCurrency: CanonicalCurrency) => apiClient<FinanceSettings, FinanceSettings>({ path: `/tenants/${tenantId}/finance/settings`, method: 'PATCH', body: { functionalCurrency } });
export const listExchangeRates = (tenantId: string) => apiClient<ExchangeRate[]>({ path: `/tenants/${tenantId}/finance/exchange-rates` });
export const createExchangeRate = (tenantId: string, body: ExchangeRateInput) => apiClient<ExchangeRate, ExchangeRateInput>({ path: `/tenants/${tenantId}/finance/exchange-rates`, method: 'POST', body });
export const updateExchangeRate = (tenantId: string, id: string, body: ExchangeRateUpdateInput) => apiClient<ExchangeRate, ExchangeRateUpdateInput>({ path: `/tenants/${tenantId}/finance/exchange-rates/${id}`, method: 'PATCH', body });
