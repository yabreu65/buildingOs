'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/http/client';
import { useTenantId } from '../tenant.hooks';
import { formatCurrency, getLocaleForCurrency } from '@/shared/lib/format/money';

export interface TenantBranding {
  tenantId: string;
  tenantName: string;
  brandName?: string;
  logoFileId?: string;
  primaryColor?: string;
  secondaryColor?: string;
  theme?: string;
  emailFooter?: string;
  currency?: string; // ARS, VES, USD
  locale?: string; // es-AR, es-VE, en-US
}

/**
 * Fetch tenant branding configuration including currency and locale
 */
export function useTenantBranding() {
  const tenantId = useTenantId();

  const { data, isLoading, error } = useQuery<TenantBranding>({
    queryKey: ['tenantBranding', tenantId],
    queryFn: () =>
      apiClient<TenantBranding>({
        path: `/tenants/${tenantId}/branding`,
        method: 'GET',
      }),
    enabled: !!tenantId,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  return {
    branding: data,
    isLoading,
    error,
    currency: data?.currency ?? 'ARS',
    locale: data?.locale ?? 'es-AR',
  };
}

/**
 * Hook that returns the tenant's configured currency with a pre-bound format function.
 * Use this anywhere you need to display monetary amounts consistently across the app.
 *
 * @example
 * const { format } = useTenantCurrency();
 * return <span>{format(charge.amount)}</span>;
 */
export function useTenantCurrency() {
  const { currency, locale } = useTenantBranding();
  const resolvedLocale = locale !== 'es-AR' ? locale : getLocaleForCurrency(currency);

  return {
    currency,
    locale: resolvedLocale,
    format: (cents: number) => formatCurrency(cents, currency, resolvedLocale),
  };
}

/**
 * Update tenant branding configuration including currency and locale
 */
export async function updateTenantBranding(
  tenantId: string,
  updates: Partial<TenantBranding>
): Promise<TenantBranding> {
  return apiClient<TenantBranding, Partial<TenantBranding>>({
    path: `/tenants/${tenantId}/branding`,
    method: 'PATCH',
    body: updates,
  });
}
