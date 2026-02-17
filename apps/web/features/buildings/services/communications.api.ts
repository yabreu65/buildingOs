/**
 * Communications API Service
 * Calls backend endpoints for communications (admin + user inbox)
 */

import { getToken } from '@/features/auth/session.storage';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const isDev = process.env.NODE_ENV === 'development';

// ============================================
// Types
// ============================================
export type CommunicationStatus = 'DRAFT' | 'SCHEDULED' | 'SENT';
export type CommunicationChannel = 'EMAIL' | 'SMS' | 'PUSH' | 'IN_APP';
export type TargetType = 'ALL_TENANT' | 'BUILDING' | 'UNIT' | 'ROLE';

export interface CommunicationTarget {
  id: string;
  targetType: TargetType;
  targetId?: string;
}

export interface CommunicationReceipt {
  id: string;
  userId: string;
  createdAt: string;
  deliveredAt?: string;
  readAt?: string;
}

export interface Communication {
  id: string;
  tenantId: string;
  buildingId: string;
  title: string;
  body: string;
  channel: CommunicationChannel;
  status: CommunicationStatus;
  createdBy: {
    id: string;
    name: string;
    email: string;
  };
  targets: CommunicationTarget[];
  receipts: CommunicationReceipt[];
  createdAt: string;
  scheduledAt?: string;
  sentAt?: string;
}

export interface CreateCommunicationInput {
  title: string;
  body: string;
  channel: CommunicationChannel;
  targets: Array<{ targetType: TargetType; targetId?: string }>;
}

export interface UpdateCommunicationInput {
  title?: string;
  body?: string;
  channel?: CommunicationChannel;
  targets?: Array<{ targetType: TargetType; targetId?: string }>;
}

export interface InboxCommunication extends Communication {
  receipts: CommunicationReceipt[];
}

// ============================================
// Logging Helpers (Dev Only)
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
// Headers Helpers
// ============================================
function validateTenantId(tenantId: string | undefined): asserts tenantId is string {
  if (!tenantId || tenantId.trim() === '') {
    throw new Error('[API] Missing tenantId - cannot make tenant-scoped API calls');
  }
}

function getAdminHeaders(tenantId: string): HeadersInit {
  validateTenantId(tenantId);
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    'X-Tenant-Id': tenantId,
  };
}

function getUserHeaders(): HeadersInit {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

// ============================================
// Admin Endpoints (Building-Scoped)
// ============================================

/**
 * List all communications in a building
 */
export async function listCommunications(
  buildingId: string,
  tenantId: string,
  filters?: {
    status?: CommunicationStatus;
    channel?: CommunicationChannel;
  }
): Promise<Communication[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.append('status', filters.status);
  if (filters?.channel) params.append('channel', filters.channel);

  const endpoint = `/buildings/${buildingId}/communications${params.toString() ? '?' + params.toString() : ''}`;
  logRequest('GET', endpoint);

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers: getAdminHeaders(tenantId),
  });

  if (!response.ok) {
    const message = `Failed to list communications: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  return response.json();
}

/**
 * Get a single communication
 */
export async function getCommunication(
  buildingId: string,
  communicationId: string,
  tenantId: string
): Promise<Communication> {
  const endpoint = `/buildings/${buildingId}/communications/${communicationId}`;
  logRequest('GET', endpoint);

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers: getAdminHeaders(tenantId),
  });

  if (!response.ok) {
    const message = `Failed to get communication: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  return response.json();
}

/**
 * Create a new communication (draft)
 */
export async function createCommunication(
  buildingId: string,
  tenantId: string,
  input: CreateCommunicationInput
): Promise<Communication> {
  const endpoint = `/buildings/${buildingId}/communications`;
  logRequest('POST', endpoint, input);

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: getAdminHeaders(tenantId),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const message = `Failed to create communication: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  return response.json();
}

/**
 * Update a communication (draft only)
 */
export async function updateCommunication(
  buildingId: string,
  communicationId: string,
  tenantId: string,
  input: UpdateCommunicationInput
): Promise<Communication> {
  const endpoint = `/buildings/${buildingId}/communications/${communicationId}`;
  logRequest('PATCH', endpoint, input);

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'PATCH',
    headers: getAdminHeaders(tenantId),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const message = `Failed to update communication: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  return response.json();
}

/**
 * Send/publish a communication (DRAFT → SENT/SCHEDULED)
 */
export async function sendCommunication(
  buildingId: string,
  communicationId: string,
  tenantId: string
): Promise<Communication> {
  const endpoint = `/buildings/${buildingId}/communications/${communicationId}/send`;
  logRequest('POST', endpoint);

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: getAdminHeaders(tenantId),
  });

  if (!response.ok) {
    const message = `Failed to send communication: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  return response.json();
}

/**
 * Delete a communication (draft only)
 */
export async function deleteCommunication(
  buildingId: string,
  communicationId: string,
  tenantId: string
): Promise<void> {
  const endpoint = `/buildings/${buildingId}/communications/${communicationId}`;
  logRequest('DELETE', endpoint);

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'DELETE',
    headers: getAdminHeaders(tenantId),
  });

  if (!response.ok) {
    const message = `Failed to delete communication: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }
}

// ============================================
// User Inbox Endpoints
// ============================================

/**
 * Get user's inbox communications
 */
export async function getInbox(filters?: {
  status?: CommunicationStatus;
  buildingId?: string;
}): Promise<InboxCommunication[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.append('status', filters.status);
  if (filters?.buildingId) params.append('buildingId', filters.buildingId);

  const endpoint = `/me/communications${params.toString() ? '?' + params.toString() : ''}`;
  logRequest('GET', endpoint);

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers: getUserHeaders(),
  });

  if (!response.ok) {
    const message = `Failed to get inbox: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  return response.json();
}

/**
 * Mark a communication as read
 */
export async function markAsRead(communicationId: string): Promise<void> {
  const endpoint = `/me/communications/${communicationId}/read`;
  logRequest('POST', endpoint);

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: getUserHeaders(),
  });

  if (!response.ok) {
    const message = `Failed to mark as read: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }
}
