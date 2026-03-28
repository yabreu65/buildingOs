/**
 * Units API Service
 * Calls the backend API endpoints for units (tenant-level and building-scoped)
 */

import { apiClient, HttpError } from '@/shared/lib/http/client';

const isDev = process.env.NODE_ENV === 'development';

// ============================================
// Types
// ============================================

export interface Building {
  id: string;
  name: string;
}

export interface UnitOccupant {
  id: string;
  memberId: string;
  unitId: string;
  role: 'OWNER' | 'RESIDENT';
  member: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
  };
}

export interface UnitCategory {
  id: string;
  name: string;
}

export interface Unit {
  id: string;
  buildingId: string;
  code?: string;
  label: string;
  unitType: 'APARTMENT' | 'HOUSE' | 'OFFICE' | 'STORAGE' | 'PARKING' | 'OTHER';
  occupancyStatus: 'UNKNOWN' | 'VACANT' | 'OCCUPIED';
  m2?: number;
  unitCategory?: UnitCategory | null;
  createdAt: string;
  updatedAt: string;
  building?: Building;
  unitOccupants?: UnitOccupant[];
}

export interface CreateUnitInput {
  buildingId: string;
  code: string;
  label?: string;
  unitType?: string;
  occupancyStatus?: string;
  m2?: number;
}

export interface UpdateUnitInput {
  code?: string;
  label?: string;
  unitType?: string;
  occupancyStatus?: string;
  m2?: number;
  unitCategoryId?: string | null;
}

// ============================================
// Logging Helper (Dev Only)
// ============================================

function logRequest(method: string, endpoint: string, body?: unknown) {
  if (!isDev) return;
  console.log(`[API] ${method} ${endpoint}`, body && JSON.stringify(body));
}

function logError(endpoint: string, status: number, message: string) {
  if (!isDev) return;
  console.error(`[API ERROR] ${endpoint} (${status})`, message);
}


// ============================================
// Tenant-Level Units API (List All)
// ============================================

/**
 * List all units for a tenant
 * GET /tenants/:tenantId/units?buildingId=optional
 */
export async function listUnitsByTenant(
  tenantId: string,
  buildingId?: string | null,
): Promise<Unit[]> {
  // If buildingId is null, return empty array (no building selected)
  if (buildingId === null) {
    return [];
  }
  
  const queryParams = buildingId ? `?buildingId=${buildingId}` : '';
  const endpoint = `/tenants/${tenantId}/units${queryParams}`;
  logRequest('GET', endpoint);

  try {
    const data = await apiClient<Unit[]>({
      path: endpoint,
      method: 'GET',
    });
    return data;
  } catch (error) {
    const httpError = error instanceof HttpError ? error : new HttpError(500, 'Unknown', String(error));
    logError(endpoint, httpError.status, httpError.message);
    throw error;
  }
}

// ============================================
// Building-Scoped Units API
// ============================================

/**
 * List units for a building
 * GET /tenants/:tenantId/buildings/:buildingId/units
 */
export async function listUnitsByBuilding(
  tenantId: string,
  buildingId: string,
): Promise<Unit[]> {
  const endpoint = `/tenants/${tenantId}/buildings/${buildingId}/units`;
  logRequest('GET', endpoint);

  try {
    const data = await apiClient<Unit[]>({
      path: endpoint,
      method: 'GET',
    });
    return data;
  } catch (error) {
    const httpError = error instanceof HttpError ? error : new HttpError(500, 'Unknown', String(error));
    logError(endpoint, httpError.status, httpError.message);
    throw error;
  }
}

/**
 * Get a single unit
 * GET /tenants/:tenantId/buildings/:buildingId/units/:unitId
 */
export async function getUnit(
  tenantId: string,
  buildingId: string,
  unitId: string,
): Promise<Unit> {
  const endpoint = `/tenants/${tenantId}/buildings/${buildingId}/units/${unitId}`;
  logRequest('GET', endpoint);

  try {
    const data = await apiClient<Unit>({
      path: endpoint,
      method: 'GET',
    });
    return data;
  } catch (error) {
    const httpError = error instanceof HttpError ? error : new HttpError(500, 'Unknown', String(error));
    logError(endpoint, httpError.status, httpError.message);
    throw error;
  }
}

/**
 * Create a new unit
 * POST /tenants/:tenantId/buildings/:buildingId/units
 */
export async function createUnit(
  tenantId: string,
  buildingId: string,
  input: Omit<CreateUnitInput, 'buildingId'>,
): Promise<Unit> {
  const endpoint = `/tenants/${tenantId}/buildings/${buildingId}/units`;
  logRequest('POST', endpoint, input);

  try {
    const data = await apiClient<Unit, Omit<CreateUnitInput, 'buildingId'>>({
      path: endpoint,
      method: 'POST',
      body: input,
    });
    return data;
  } catch (error) {
    const httpError = error instanceof HttpError ? error : new HttpError(500, 'Unknown', String(error));
    logError(endpoint, httpError.status, httpError.message);
    throw error;
  }
}

/**
 * Update a unit
 * PATCH /tenants/:tenantId/buildings/:buildingId/units/:unitId
 */
export async function updateUnit(
  tenantId: string,
  buildingId: string,
  unitId: string,
  input: UpdateUnitInput,
): Promise<Unit> {
  const endpoint = `/tenants/${tenantId}/buildings/${buildingId}/units/${unitId}`;
  logRequest('PATCH', endpoint, input);

  try {
    const data = await apiClient<Unit, UpdateUnitInput>({
      path: endpoint,
      method: 'PATCH',
      body: input,
    });
    return data;
  } catch (error) {
    const httpError = error instanceof HttpError ? error : new HttpError(500, 'Unknown', String(error));
    logError(endpoint, httpError.status, httpError.message);
    throw error;
  }
}

/**
 * Assign an occupant to a unit
 * POST /tenants/:tenantId/buildings/:buildingId/units/:unitId/occupants
 */
export async function assignOccupant(
  tenantId: string,
  buildingId: string,
  unitId: string,
  memberId: string,
  role: 'OWNER' | 'RESIDENT' = 'RESIDENT',
): Promise<UnitOccupant> {
  const endpoint = `/tenants/${tenantId}/buildings/${buildingId}/units/${unitId}/occupants`;
  logRequest('POST', endpoint, { memberId, role });

  return apiClient<UnitOccupant, { memberId: string; role: string }>({
    path: endpoint,
    method: 'POST',
    body: { memberId, role },
  });
}

/**
 * Remove an occupant from a unit
 * DELETE /tenants/:tenantId/buildings/:buildingId/units/:unitId/occupants/:occupantId
 */
export async function removeOccupant(
  tenantId: string,
  buildingId: string,
  unitId: string,
  occupantId: string,
): Promise<void> {
  const endpoint = `/tenants/${tenantId}/buildings/${buildingId}/units/${unitId}/occupants/${occupantId}`;
  logRequest('DELETE', endpoint);

  await apiClient<void>({
    path: endpoint,
    method: 'DELETE',
  });
}

/**
 * Delete a unit
 * DELETE /tenants/:tenantId/buildings/:buildingId/units/:unitId
 */
export async function deleteUnit(
  tenantId: string,
  buildingId: string,
  unitId: string,
): Promise<void> {
  const endpoint = `/tenants/${tenantId}/buildings/${buildingId}/units/${unitId}`;
  logRequest('DELETE', endpoint);

  try {
    await apiClient<void>({
      path: endpoint,
      method: 'DELETE',
    });
  } catch (error) {
    const httpError = error instanceof HttpError ? error : new HttpError(500, 'Unknown', String(error));
    logError(endpoint, httpError.status, httpError.message);
    throw error;
  }
}
