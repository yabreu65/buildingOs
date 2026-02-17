'use client';

import { useQuery } from '@tanstack/react-query';
import { apiListTenants, type TenantSummary } from './tenants.service';

/**
 * Hook para obtener lista de tenants donde el usuario tiene membership.
 * Usa React Query para caching y manejo de estados.
 *
 * @returns Query con data: TenantSummary[], isLoading, error, etc.
 */
export function useTenants() {
  return useQuery<TenantSummary[]>({
    queryKey: ['tenants'],
    queryFn: apiListTenants,
    staleTime: 1000 * 60 * 5, // 5 minutos
    retry: 1,
  });
}
