import { UserContext, ContextOptions } from './context.types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

/**
 * Get current user context for active tenant
 */
export async function getContext(tenantId: string): Promise<UserContext> {
  const response = await fetch(`${API_URL}/me/context`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': tenantId,
      Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get context: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Set active building and/or unit
 */
export async function setContext(
  tenantId: string,
  activeBuildingId?: string | null,
  activeUnitId?: string | null,
): Promise<UserContext> {
  const response = await fetch(`${API_URL}/me/context`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': tenantId,
      Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
    },
    body: JSON.stringify({
      activeBuildingId: activeBuildingId || null,
      activeUnitId: activeUnitId || null,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to set context: ${error}`);
  }

  return response.json();
}

/**
 * Get available buildings and units for context selection
 */
export async function getContextOptions(tenantId: string): Promise<ContextOptions> {
  const response = await fetch(`${API_URL}/me/context/options`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': tenantId,
      Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get context options: ${response.statusText}`);
  }

  return response.json();
}
