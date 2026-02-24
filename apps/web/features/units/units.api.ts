/**
 * Units API Service
 * Calls the backend API endpoints for units (tenant-level and building-scoped)
 */

import { getToken } from '@/features/auth/session.storage';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
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
  userId: string;
  unitId: string;
  role: 'OWNER' | 'RESIDENT';
  user: {
    id: string;
    name: string;
    email: string;
  };
}

export interface Unit {
  id: string;
  buildingId: string;
  code?: string;
  label: string;
  unitType: 'APARTMENT' | 'HOUSE' | 'OFFICE' | 'STORAGE' | 'PARKING' | 'OTHER';
  occupancyStatus: 'UNKNOWN' | 'VACANT' | 'OCCUPIED';
  createdAt: string;
  updatedAt: string;
  building?: Building;
  unitOccupants?: UnitOccupant[];
}

export interface CreateUnitInput {
  buildingId: string;
  code?: string;
  label: string;
  unitType?: string;
  occupancyStatus?: string;
}

export interface UpdateUnitInput {
  code?: string;
  label?: string;
  unitType?: string;
  occupancyStatus?: string;
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
// Headers Helper
// ============================================

function getHeaders(): HeadersInit {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : '',
  };
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
  buildingId?: string,
): Promise<Unit[]> {
  const queryParams = buildingId ? `?buildingId=${buildingId}` : '';
  const endpoint = `/tenants/${tenantId}/units${queryParams}`;
  logRequest('GET', endpoint);

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const message = `Failed to list units: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  const data = await response.json();
  return data;
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

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const message = `Failed to list building units: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  const data = await response.json();
  return data;
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

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const message = `Failed to get unit: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  const data = await response.json();
  return data;
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

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const message = `Failed to create unit: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  const data = await response.json();
  return data;
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

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const message = `Failed to update unit: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  const data = await response.json();
  return data;
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

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const message = `Failed to delete unit: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }
}
