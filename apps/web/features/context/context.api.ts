import { UserContext, ContextOptions } from './context.types';
import { apiClient } from '@/shared/lib/http/client';
import type { PortalContext } from '@/features/auth/landing-route';

function buildContextHeaders(
  tenantId: string,
  portalContext?: PortalContext | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Tenant-Id': tenantId,
  };

  if (portalContext) {
    headers['X-Portal-Context'] = portalContext;
  }

  return headers;
}

/**
 * Get current user context for active tenant
 */
export async function getContext(
  tenantId: string,
  portalContext?: PortalContext | null,
): Promise<UserContext> {
  return apiClient<UserContext>({
    path: '/me/context',
    method: 'GET',
    headers: buildContextHeaders(tenantId, portalContext),
  });
}

/**
 * Set active building and/or unit
 */
export async function setContext(
  tenantId: string,
  activeBuildingId?: string | null,
  activeUnitId?: string | null,
  portalContext?: PortalContext | null,
): Promise<UserContext> {
  return apiClient<UserContext, { activeBuildingId: string | null; activeUnitId: string | null }>({
    path: '/me/context',
    method: 'POST',
    headers: buildContextHeaders(tenantId, portalContext),
    body: {
      activeBuildingId: activeBuildingId || null,
      activeUnitId: activeUnitId || null,
    },
  });
}

/**
 * Get available buildings and units for context selection
 */
export async function getContextOptions(
  tenantId: string,
  portalContext?: PortalContext | null,
): Promise<ContextOptions> {
  return apiClient<ContextOptions>({
    path: '/me/context/options',
    method: 'GET',
    headers: buildContextHeaders(tenantId, portalContext),
  });
}
