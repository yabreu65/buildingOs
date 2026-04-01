'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/http/client';
import { useTenantId } from '../tenant.hooks';

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
