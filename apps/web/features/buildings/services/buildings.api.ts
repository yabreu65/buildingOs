/**
 * Buildings API Service
 * Calls the backend API endpoints for buildings, units, and occupants
 */

import { getToken } from '@/features/auth/session.storage';
import type { Building, Unit, User } from '@/features/units/units.types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const isDev = process.env.NODE_ENV === 'development';

// ============================================
// Logging Helper (Dev Only)
// ============================================
function logRequest(
  method: string,
  endpoint: string,
  headers: HeadersInit,
  body?: unknown
) {
  if (!isDev) return;
  const headersObj = headers as Record<string, string>;
  console.log(`[API] ${method} ${endpoint}`, {
    headers: {
      'Content-Type': headersObj['Content-Type'],
      'Authorization': headersObj['Authorization']
        ? `Bearer ${headersObj['Authorization'].substring(0, 20)}...`
        : 'NONE',
      'X-Tenant-Id': headersObj['X-Tenant-Id'] || 'NONE',
    },
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

function getHeaders(tenantId?: string): HeadersInit {
  // ✅ Validate tenantId before making any requests
  validateTenantId(tenantId);

  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    'X-Tenant-Id': tenantId, // ✅ Always include X-Tenant-Id (validated above)
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
  const headers = getHeaders(tenantId);
  logRequest('GET', endpoint, headers);

  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    const error = new Error(`Failed to fetch buildings: ${res.status}`);
    logError(endpoint, res.status, error);
    throw error;
  }

  const data = await res.json();
  logResponse(endpoint, res.status, data);
  return data;
}

/**
 * GET /tenants/:tenantId/buildings/:buildingId
 * Get a single building with its units
 */
export async function fetchBuildingById(
  tenantId: string,
  buildingId: string
): Promise<Building & { units: Unit[] }> {
  const res = await fetch(`${API_URL}/tenants/${tenantId}/buildings/${buildingId}`, {
    method: 'GET',
    headers: getHeaders(tenantId),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch building: ${res.status}`);
  }

  return res.json();
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
  const headers = getHeaders(tenantId);
  logRequest('POST', endpoint, headers, data);

  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = new Error(`Failed to create building: ${res.status}`);
    logError(endpoint, res.status, error);
    throw error;
  }

  const result = await res.json();
  logResponse(endpoint, res.status, result);
  return result;
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
  const headers = getHeaders(tenantId);
  logRequest('PATCH', endpoint, headers, data);

  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = new Error(`Failed to update building: ${res.status}`);
    logError(endpoint, res.status, error);
    throw error;
  }

  const result = await res.json();
  logResponse(endpoint, res.status, result);
  return result;
}

/**
 * DELETE /tenants/:tenantId/buildings/:buildingId
 * Delete a building
 */
export async function deleteBuilding(tenantId: string, buildingId: string): Promise<void> {
  const endpoint = `/tenants/${tenantId}/buildings/${buildingId}`;
  const headers = getHeaders(tenantId);
  logRequest('DELETE', endpoint, headers);

  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'DELETE',
    headers,
  });

  if (!res.ok) {
    const error = new Error(`Failed to delete building: ${res.status}`);
    logError(endpoint, res.status, error);
    throw error;
  }

  logResponse(endpoint, res.status, { success: true });
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
  const headers = getHeaders(tenantId);
  logRequest('GET', endpoint, headers);

  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    const error = new Error(`Failed to fetch units: ${res.status}`);
    logError(endpoint, res.status, error);
    throw error;
  }

  const data = await res.json();
  logResponse(endpoint, res.status, data);
  return data;
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
  const headers = getHeaders(tenantId);
  logRequest('GET', endpoint, headers);

  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    const error = new Error(`Failed to fetch unit: ${res.status}`);
    logError(endpoint, res.status, error);
    throw error;
  }

  const data = await res.json();
  logResponse(endpoint, res.status, data);
  return data;
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
  const headers = getHeaders(tenantId);
  logRequest('POST', endpoint, headers, data);

  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = new Error(`Failed to create unit: ${res.status}`);
    logError(endpoint, res.status, error);
    throw error;
  }

  const result = await res.json();
  logResponse(endpoint, res.status, result);
  return result;
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
  const headers = getHeaders(tenantId);
  logRequest('PATCH', endpoint, headers, data);

  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = new Error(`Failed to update unit: ${res.status}`);
    logError(endpoint, res.status, error);
    throw error;
  }

  const result = await res.json();
  logResponse(endpoint, res.status, result);
  return result;
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
  const headers = getHeaders(tenantId);
  logRequest('DELETE', endpoint, headers);

  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'DELETE',
    headers,
  });

  if (!res.ok) {
    const error = new Error(`Failed to delete unit: ${res.status}`);
    logError(endpoint, res.status, error);
    throw error;
  }

  logResponse(endpoint, res.status, { success: true });
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
  const headers = getHeaders(tenantId);
  logRequest('GET', endpoint, headers);

  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    const error = new Error(`Failed to fetch occupants: ${res.status}`);
    logError(endpoint, res.status, error);
    throw error;
  }

  const data = await res.json();
  logResponse(endpoint, res.status, data);
  return data;
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
  const headers = getHeaders(tenantId);
  logRequest('POST', endpoint, headers, data);

  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = new Error(`Failed to assign occupant: ${res.status}`);
    logError(endpoint, res.status, error);
    throw error;
  }

  const result = await res.json();
  logResponse(endpoint, res.status, result);
  return result;
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
  const headers = getHeaders(tenantId);
  logRequest('DELETE', endpoint, headers);

  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'DELETE',
    headers,
  });

  if (!res.ok) {
    const error = new Error(`Failed to remove occupant: ${res.status}`);
    logError(endpoint, res.status, error);
    throw error;
  }

  logResponse(endpoint, res.status, { success: true });
}
