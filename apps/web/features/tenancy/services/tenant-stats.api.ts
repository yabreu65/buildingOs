/**
 * Tenant Stats API Service
 * Calls the backend API endpoints for tenant statistics, billing, and audit logs
 */

import { getToken } from '@/features/auth/session.storage';

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
function getHeaders(tenantId?: string): HeadersInit {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(tenantId && { 'X-Tenant-Id': tenantId }),
  };
}

// ============================================
// Type Definitions
// ============================================

export interface TenantStatsResponse {
  totalBuildings: number;
  totalUnits: number;
  occupiedUnits: number;
  vacantUnits: number;
  unknownUnits: number;
  totalResidents: number;
}

export interface BillingPlan {
  name: string;
  planId: string;
  maxBuildings: number;
  maxUnits: number;
  maxUsers: number;
  maxOccupants: number;
  canExportReports: boolean;
  canBulkOperations: boolean;
  supportLevel: string;
  monthlyPrice: number;
}

export interface BillingUsage {
  buildings: number;
  units: number;
  users: number;
  residents: number;
}

export interface SubscriptionInfo {
  status: string;
  planId: string;
  currentPeriodEnd: string | null;
  trialEndDate: string | null;
}

export interface TenantBillingResponse {
  subscription: SubscriptionInfo;
  plan: BillingPlan;
  usage: BillingUsage;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  actorUserId: string | null;
  actorName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogsResponse {
  data: AuditLogEntry[];
  total: number;
}

// ============================================
// Stats API
// ============================================

/**
 * GET /tenants/:tenantId/stats
 * Fetch tenant statistics (buildings, units, occupancy, residents)
 */
export async function fetchTenantStats(
  tenantId: string
): Promise<TenantStatsResponse> {
  const endpoint = `/tenants/${tenantId}/stats`;
  const headers = getHeaders(tenantId);
  logRequest('GET', endpoint, headers);

  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    const error = new Error(`Failed to fetch tenant stats: ${res.status}`);
    logError(endpoint, res.status, error);
    throw error;
  }

  const data = await res.json();
  logResponse(endpoint, res.status, data);
  return data;
}

// ============================================
// Billing API
// ============================================

/**
 * GET /tenants/:tenantId/billing
 * Fetch tenant billing information (subscription, plan, usage)
 */
export async function fetchTenantBilling(
  tenantId: string
): Promise<TenantBillingResponse> {
  const endpoint = `/tenants/${tenantId}/billing`;
  const headers = getHeaders(tenantId);
  logRequest('GET', endpoint, headers);

  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    const error = new Error(`Failed to fetch tenant billing: ${res.status}`);
    logError(endpoint, res.status, error);
    throw error;
  }

  const data = await res.json();
  logResponse(endpoint, res.status, data);
  return data;
}

// ============================================
// Audit Logs API
// ============================================

export interface AuditLogsQuery {
  skip?: number;
  take?: number;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * GET /tenants/:tenantId/audit-logs
 * Fetch audit logs for a tenant with optional filtering and pagination
 */
export async function fetchTenantAuditLogs(
  tenantId: string,
  query?: AuditLogsQuery
): Promise<AuditLogsResponse> {
  const params = new URLSearchParams();

  if (query?.skip !== undefined) params.append('skip', query.skip.toString());
  if (query?.take !== undefined) params.append('take', query.take.toString());
  if (query?.action) params.append('action', query.action);
  if (query?.dateFrom) params.append('dateFrom', query.dateFrom);
  if (query?.dateTo) params.append('dateTo', query.dateTo);

  const queryStr = params.toString();
  const endpoint = `/tenants/${tenantId}/audit-logs${queryStr ? `?${queryStr}` : ''}`;
  const headers = getHeaders(tenantId);
  logRequest('GET', endpoint, headers);

  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    const error = new Error(`Failed to fetch audit logs: ${res.status}`);
    logError(endpoint, res.status, error);
    throw error;
  }

  const data = await res.json();
  logResponse(endpoint, res.status, data);
  return data;
}
