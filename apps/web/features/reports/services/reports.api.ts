/**
 * Reports API Service
 * Calls the backend reports endpoints for aggregated metrics
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
  console.log(`[REPORTS API] ${method} ${endpoint}`, {
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
  console.log(`[REPORTS API RESPONSE] ${endpoint} (${status})`, data);
}

function logError(endpoint: string, status: number, error: Error) {
  if (!isDev) return;
  console.error(`[REPORTS API ERROR] ${endpoint} (${status})`, error.message);
}

// ============================================
// Headers Helper
// ============================================
function validateTenantId(tenantId: string | undefined): asserts tenantId is string {
  if (!tenantId || tenantId.trim() === '') {
    throw new Error(
      '[REPORTS API] Missing tenantId - cannot make tenant-scoped API calls without tenant context'
    );
  }
}

function getHeaders(tenantId?: string): HeadersInit {
  validateTenantId(tenantId);

  const token = getToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Tenant-Id': tenantId,
  };
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
  const url = `${API_URL}${endpoint}`;
  const headers = getHeaders(tenantId);

  logRequest('GET', endpoint, headers);

  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    logError(endpoint, response.status, error);
    throw error;
  }

  const data = await response.json();
  logResponse(endpoint, response.status, data);
  return data;
}

export async function getFinanceReport(
  tenantId: string,
  { buildingId, period }: { buildingId?: string; period?: string } = {}
): Promise<FinanceReport> {
  const endpoint = `/tenants/${tenantId}/reports/finance${buildQuery({
    buildingId,
    period,
  })}`;
  const url = `${API_URL}${endpoint}`;
  const headers = getHeaders(tenantId);

  logRequest('GET', endpoint, headers);

  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    logError(endpoint, response.status, error);
    throw error;
  }

  const data = await response.json();
  logResponse(endpoint, response.status, data);
  return data;
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
  const url = `${API_URL}${endpoint}`;
  const headers = getHeaders(tenantId);

  logRequest('GET', endpoint, headers);

  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    logError(endpoint, response.status, error);
    throw error;
  }

  const data = await response.json();
  logResponse(endpoint, response.status, data);
  return data;
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
  const url = `${API_URL}${endpoint}`;
  const headers = getHeaders(tenantId);

  logRequest('GET', endpoint, headers);

  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    logError(endpoint, response.status, error);
    throw error;
  }

  const data = await response.json();
  logResponse(endpoint, response.status, data);
  return data;
}
