/**
 * Tenant Stats API Service
 * Calls the backend API endpoints for tenant statistics, billing, and audit logs
 */

import { apiClient, HttpError } from '@/shared/lib/http/client';

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
  console.log(`[API] ${method} ${endpoint}`, body && JSON.stringify(body));
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
  logRequest('GET', endpoint);

  try {
    const data = await apiClient<TenantStatsResponse>({
      path: endpoint,
      method: 'GET',
      headers: {
        'X-Tenant-Id': tenantId,
      },
    });
    logResponse(endpoint, 200, data);
    return data;
  } catch (error) {
    const httpError = error instanceof HttpError ? error : new HttpError(500, 'Unknown', String(error));
    logError(endpoint, httpError.status, httpError);
    throw error;
  }
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
  logRequest('GET', endpoint);

  try {
    const data = await apiClient<TenantBillingResponse>({
      path: endpoint,
      method: 'GET',
      headers: {
        'X-Tenant-Id': tenantId,
      },
    });
    logResponse(endpoint, 200, data);
    return data;
  } catch (error) {
    const httpError = error instanceof HttpError ? error : new HttpError(500, 'Unknown', String(error));
    logError(endpoint, httpError.status, httpError);
    throw error;
  }
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
  logRequest('GET', endpoint);

  try {
    const data = await apiClient<AuditLogsResponse>({
      path: endpoint,
      method: 'GET',
      headers: {
        'X-Tenant-Id': tenantId,
      },
    });
    logResponse(endpoint, 200, data);
    return data;
  } catch (error) {
    const httpError = error instanceof HttpError ? error : new HttpError(500, 'Unknown', String(error));
    logError(endpoint, httpError.status, httpError);
    throw error;
  }
}
