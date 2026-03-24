import { UserContext, ContextOptions } from './context.types';
import { apiClient } from '@/shared/lib/http/client';

/**
 * Get current user context for active tenant
 */
export async function getContext(tenantId: string): Promise<UserContext> {
  return apiClient<UserContext>({
    path: '/me/context',
    method: 'GET',
    headers: {
      'X-Tenant-Id': tenantId,
    },
  });
}

/**
 * Set active building and/or unit
 */
export async function setContext(
  tenantId: string,
  activeBuildingId?: string | null,
  activeUnitId?: string | null,
): Promise<UserContext> {
  return apiClient<UserContext, { activeBuildingId: string | null; activeUnitId: string | null }>({
    path: '/me/context',
    method: 'POST',
    headers: {
      'X-Tenant-Id': tenantId,
    },
    body: {
      activeBuildingId: activeBuildingId || null,
      activeUnitId: activeUnitId || null,
    },
  });
}

/**
 * Get available buildings and units for context selection
 */
export async function getContextOptions(tenantId: string): Promise<ContextOptions> {
  return apiClient<ContextOptions>({
    path: '/me/context/options',
    method: 'GET',
    headers: {
      'X-Tenant-Id': tenantId,
    },
  });
}
