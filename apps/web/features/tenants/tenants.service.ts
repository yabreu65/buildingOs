import { apiClient } from '@/shared/lib/http/client';

export interface TenantSummary {
  id: string;
  name: string;
  type: 'ADMINISTRADORA' | 'EDIFICIO_AUTOGESTION';
}

/**
 * Obtiene la lista de tenants donde el usuario tiene membership.
 * Requiere token JWT en Authorization header.
 *
 * @returns Array de TenantSummary ordenados por nombre
 */
export async function apiListTenants(): Promise<TenantSummary[]> {
  return apiClient<TenantSummary[]>({
    path: '/tenants',
    method: 'GET',
  });
}
