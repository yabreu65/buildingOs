/**
 * Buildings API Service
 * Calls the backend API endpoints for buildings, units, and occupants
 */

import { apiClient } from '@/shared/lib/http/client';
import type { Building, Unit, User } from '@/features/units/units.types';

const isDev = process.env.NODE_ENV === 'development';

// ============================================
// Logging Helper (Dev Only)
// ============================================
function logRequest(
  method: string,
  endpoint: string,
  body?: unknown
) {
  if (!isDev) return;
  console.log(`[API] ${method} ${endpoint}`, {
    body: body && JSON.stringify(body),
  });
}

function logResponse(endpoint: string, status: number, data: unknown) {
  if (!isDev) return;
  console.log(`[API RESPONSE] ${endpoint} (${status})`, data);
}

function logError(endpoint: string, status: number, error: Error) {
  if (!isDev) return;
  console.error(`[API ERROR] ${endpoint} (${status})`, error.message);
}

// ============================================
// Headers Helper
// ============================================
function validateTenantId(tenantId: string | undefined): asserts tenantId is string {
  if (!tenantId || tenantId.trim() === '') {
    throw new Error(
      '[API] Missing tenantId - cannot make tenant-scoped API calls without tenant context'
    );
  }
}

function getTenantHeaders(tenantId: string): Record<string, string> {
  validateTenantId(tenantId);
  return {
    'X-Tenant-Id': tenantId,
  };
}

// ============================================
// Buildings API
// ============================================

/**
 * GET /tenants/:tenantId/buildings
 * List all buildings for a tenant
 */
export async function fetchBuildings(tenantId: string): Promise<Building[]> {
  const endpoint = `/tenants/${tenantId}/buildings`;
  logRequest('GET', endpoint);

  try {
    const data = await apiClient<Building[]>({
      path: endpoint,
      method: 'GET',
      headers: getTenantHeaders(tenantId),
    });
    logResponse(endpoint, 200, data);
    return data;
  } catch (error) {
    const err = error as Error;
    logError(endpoint, 500, err);
    throw error;
  }
}

/**
 * GET /tenants/:tenantId/buildings/:buildingId
 * Get a single building with its units
 */
export async function fetchBuildingById(
  tenantId: string,
  buildingId: string
): Promise<Building & { units: Unit[] }> {
  const endpoint = `/tenants/${tenantId}/buildings/${buildingId}`;
  logRequest('GET', endpoint);

  try {
    const data = await apiClient<Building & { units: Unit[] }>({
      path: endpoint,
      method: 'GET',
      headers: getTenantHeaders(tenantId),
    });
    logResponse(endpoint, 200, data);
    return data;
  } catch (error) {
    const err = error as Error;
    logError(endpoint, 500, err);
    throw error;
  }
}

/**
 * POST /tenants/:tenantId/buildings
 * Create a new building
 */
export async function createBuilding(
  tenantId: string,
  data: { name: string; address?: string }
): Promise<Building> {
  const endpoint = `/tenants/${tenantId}/buildings`;
  logRequest('POST', endpoint, data);

  try {
    const result = await apiClient<Building, typeof data>({
      path: endpoint,
      method: 'POST',
      body: data,
      headers: getTenantHeaders(tenantId),
    });
    logResponse(endpoint, 201, result);
    return result;
  } catch (error) {
    const err = error as Error;
    logError(endpoint, 500, err);
    throw error;
  }
}

/**
 * PATCH /tenants/:tenantId/buildings/:buildingId
 * Update a building
 */
export async function updateBuilding(
  tenantId: string,
  buildingId: string,
  data: { name?: string; address?: string }
): Promise<Building> {
  const endpoint = `/tenants/${tenantId}/buildings/${buildingId}`;
  logRequest('PATCH', endpoint, data);

  try {
    const result = await apiClient<Building, typeof data>({
      path: endpoint,
      method: 'PATCH',
      body: data,
      headers: getTenantHeaders(tenantId),
    });
    logResponse(endpoint, 200, result);
    return result;
  } catch (error) {
    const err = error as Error;
    logError(endpoint, 500, err);
    throw error;
  }
}

/**
 * DELETE /tenants/:tenantId/buildings/:buildingId
 * Delete a building
 */
export async function deleteBuilding(tenantId: string, buildingId: string): Promise<void> {
  const endpoint = `/tenants/${tenantId}/buildings/${buildingId}`;
  logRequest('DELETE', endpoint);

  try {
    await apiClient<void>({
      path: endpoint,
      method: 'DELETE',
      headers: getTenantHeaders(tenantId),
    });
    logResponse(endpoint, 204, { success: true });
  } catch (error) {
    const err = error as Error;
    logError(endpoint, 500, err);
    throw error;
  }
}

// ============================================
// Units API
// ============================================

/**
 * GET /tenants/:tenantId/buildings/:buildingId/units
 * List all units in a building
 */
export async function fetchUnits(tenantId: string, buildingId: string): Promise<Unit[]> {
  const endpoint = `/tenants/${tenantId}/buildings/${buildingId}/units`;
  logRequest('GET', endpoint);

  try {
    const data = await apiClient<any[]>({
      path: endpoint,
      method: 'GET',
      headers: getTenantHeaders(tenantId),
    });
    logResponse(endpoint, 200, data);
    // Map 'code' from backend to 'unitCode' in frontend type
    return data.map((u) => ({
      ...u,
      unitCode: u.code || u.unitCode,
    })) as Unit[];
  } catch (error) {
    const err = error as Error;
    logError(endpoint, 500, err);
    throw error;
  }
}

/**
 * GET /tenants/:tenantId/buildings/:buildingId/units/:unitId
 * Get a single unit with its occupants
 */
export async function fetchUnitById(
  tenantId: string,
  buildingId: string,
  unitId: string
): Promise<Unit & { unitOccupants: Occupant[] }> {
  const endpoint = `/tenants/${tenantId}/buildings/${buildingId}/units/${unitId}`;
  logRequest('GET', endpoint);

  try {
    const data = await apiClient<Unit & { unitOccupants: Occupant[] }>({
      path: endpoint,
      method: 'GET',
      headers: getTenantHeaders(tenantId),
    });
    logResponse(endpoint, 200, data);
    return data;
  } catch (error) {
    const err = error as Error;
    logError(endpoint, 500, err);
    throw error;
  }
}

/**
 * POST /tenants/:tenantId/buildings/:buildingId/units
 * Create a new unit
 */
export async function createUnit(
  tenantId: string,
  buildingId: string,
  data: {
    code: string;
    label?: string;
    unitType?: string;
    occupancyStatus?: string;
  }
): Promise<Unit> {
  const endpoint = `/tenants/${tenantId}/buildings/${buildingId}/units`;
  logRequest('POST', endpoint, data);

  try {
    const result = await apiClient<Unit, typeof data>({
      path: endpoint,
      method: 'POST',
      body: data,
      headers: getTenantHeaders(tenantId),
    });
    logResponse(endpoint, 201, result);
    return result;
  } catch (error) {
    const err = error as Error;
    logError(endpoint, 500, err);
    throw error;
  }
}

/**
 * PATCH /tenants/:tenantId/buildings/:buildingId/units/:unitId
 * Update a unit
 */
export async function updateUnit(
  tenantId: string,
  buildingId: string,
  unitId: string,
  data: {
    code?: string;
    label?: string;
    unitType?: string;
    occupancyStatus?: string;
  }
): Promise<Unit> {
  const endpoint = `/tenants/${tenantId}/buildings/${buildingId}/units/${unitId}`;
  logRequest('PATCH', endpoint, data);

  try {
    const result = await apiClient<Unit, typeof data>({
      path: endpoint,
      method: 'PATCH',
      body: data,
      headers: getTenantHeaders(tenantId),
    });
    logResponse(endpoint, 200, result);
    return result;
  } catch (error) {
    const err = error as Error;
    logError(endpoint, 500, err);
    throw error;
  }
}

/**
 * DELETE /tenants/:tenantId/buildings/:buildingId/units/:unitId
 * Delete a unit
 */
export async function deleteUnit(
  tenantId: string,
  buildingId: string,
  unitId: string
): Promise<void> {
  const endpoint = `/tenants/${tenantId}/buildings/${buildingId}/units/${unitId}`;
  logRequest('DELETE', endpoint);

  try {
    await apiClient<void>({
      path: endpoint,
      method: 'DELETE',
      headers: getTenantHeaders(tenantId),
    });
    logResponse(endpoint, 204, { success: true });
  } catch (error) {
    const err = error as Error;
    logError(endpoint, 500, err);
    throw error;
  }
}

// ============================================
// Occupants API
// ============================================

export type Occupant = {
  id: string;
  unitId: string;
  userId: string;
  role: 'OWNER' | 'RESIDENT';
  user?: User;
  unit?: Unit;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * GET /tenants/:tenantId/buildings/:buildingId/units/:unitId/occupants
 * List all occupants in a unit
 */
export async function fetchOccupants(
  tenantId: string,
  buildingId: string,
  unitId: string
): Promise<Occupant[]> {
  const endpoint = `/tenants/${tenantId}/buildings/${buildingId}/units/${unitId}/occupants`;
  logRequest('GET', endpoint);

  try {
    const data = await apiClient<Occupant[]>({
      path: endpoint,
      method: 'GET',
      headers: getTenantHeaders(tenantId),
    });
    logResponse(endpoint, 200, data);
    return data;
  } catch (error) {
    const err = error as Error;
    logError(endpoint, 500, err);
    throw error;
  }
}

/**
 * POST /tenants/:tenantId/buildings/:buildingId/units/:unitId/occupants
 * Assign an occupant to a unit
 */
export async function assignOccupant(
  tenantId: string,
  buildingId: string,
  unitId: string,
  data: { userId: string; role: 'OWNER' | 'RESIDENT' }
): Promise<Occupant> {
  const endpoint = `/tenants/${tenantId}/buildings/${buildingId}/units/${unitId}/occupants`;
  logRequest('POST', endpoint, data);

  try {
    const result = await apiClient<Occupant, typeof data>({
      path: endpoint,
      method: 'POST',
      body: data,
      headers: getTenantHeaders(tenantId),
    });
    logResponse(endpoint, 201, result);
    return result;
  } catch (error) {
    const err = error as Error;
    logError(endpoint, 500, err);
    throw error;
  }
}

/**
 * DELETE /tenants/:tenantId/buildings/:buildingId/units/:unitId/occupants/:occupantId
 * Remove an occupant from a unit
 */
export async function removeOccupant(
  tenantId: string,
  buildingId: string,
  unitId: string,
  occupantId: string
): Promise<void> {
  const endpoint = `/tenants/${tenantId}/buildings/${buildingId}/units/${unitId}/occupants/${occupantId}`;
  logRequest('DELETE', endpoint);

  try {
    await apiClient<void>({
      path: endpoint,
      method: 'DELETE',
      headers: getTenantHeaders(tenantId),
    });
    logResponse(endpoint, 204, { success: true });
  } catch (error) {
    const err = error as Error;
    logError(endpoint, 500, err);
    throw error;
  }
}
