/**
 * Reports API Service
 * Calls the backend reports endpoints for aggregated metrics
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
  console.log(`[REPORTS API] ${method} ${endpoint}`, body && JSON.stringify(body));
}

function logResponse(endpoint: string, status: number, data: unknown) {
  if (!isDev) return;
  console.log(`[REPORTS API RESPONSE] ${endpoint} (${status})`, data);
}

function logError(endpoint: string, status: number, error: Error) {
  if (!isDev) return;
  console.error(`[REPORTS API ERROR] ${endpoint} (${status})`, error.message);
}

// ============================================
// Type Definitions
// ============================================

export interface TicketsReport {
  byStatus: Array<{ status: string; count: number }>;
  byPriority: Array<{ priority: string; count: number }>;
  topCategories: Array<{ category: string; count: number }>;
  avgTimeToFirstResponseHours: number;
  avgTimeToResolveHours: number;
}

export interface DelinquentUnit {
  unitId: string;
  outstanding: number;
}

export interface FinanceReport {
  totalCharges: number;
  totalPaid: number;
  totalOutstanding: number;
  delinquentUnitsCount: number;
  delinquentUnits: DelinquentUnit[];
  collectionRate: number;
  currency: string;
}

export interface ChannelBreakdown {
  channel: string;
  sent: number;
  read: number;
  readRate: number;
}

export interface CommunicationsReport {
  totalRecipients: number;
  totalRead: number;
  readRate: number;
  byChannel: ChannelBreakdown[];
}

export interface ActivityReport {
  ticketsCreated: number;
  paymentsSubmitted: number;
  documentsUploaded: number;
  communicationsSent: number;
}

// ============================================
// Query String Builder
// ============================================
function buildQuery(params: Record<string, any>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (entries.length === 0) return '';
  const qs = new URLSearchParams(
    entries.map(([k, v]) => [k, String(v)])
  ).toString();
  return `?${qs}`;
}

// ============================================
// API Methods
// ============================================

export async function getTicketsReport(
  tenantId: string,
  {
    buildingId,
    from,
    to,
  }: { buildingId?: string; from?: string; to?: string } = {}
): Promise<TicketsReport> {
  const endpoint = `/tenants/${tenantId}/reports/tickets${buildQuery({
    buildingId,
    from,
    to,
  })}`;

  logRequest('GET', endpoint);

  try {
    const data = await apiClient<TicketsReport>({
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

export async function getFinanceReport(
  tenantId: string,
  { buildingId, period }: { buildingId?: string; period?: string } = {}
): Promise<FinanceReport> {
  const endpoint = `/tenants/${tenantId}/reports/finance${buildQuery({
    buildingId,
    period,
  })}`;

  logRequest('GET', endpoint);

  try {
    const data = await apiClient<FinanceReport>({
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

export async function getCommunicationsReport(
  tenantId: string,
  {
    buildingId,
    from,
    to,
  }: { buildingId?: string; from?: string; to?: string } = {}
): Promise<CommunicationsReport> {
  const endpoint = `/tenants/${tenantId}/reports/communications${buildQuery({
    buildingId,
    from,
    to,
  })}`;

  logRequest('GET', endpoint);

  try {
    const data = await apiClient<CommunicationsReport>({
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

export async function getActivityReport(
  tenantId: string,
  {
    buildingId,
    from,
    to,
  }: { buildingId?: string; from?: string; to?: string } = {}
): Promise<ActivityReport> {
  const endpoint = `/tenants/${tenantId}/reports/activity${buildQuery({
    buildingId,
    from,
    to,
  })}`;

  logRequest('GET', endpoint);

  try {
    const data = await apiClient<ActivityReport>({
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
