/**
 * Communications API Service
 * Calls backend endpoints for communications (admin + user inbox)
 */

import { apiClient } from '@/shared/lib/http/client';

const isDev = process.env.NODE_ENV === 'development';

// ============================================
// Types
// ============================================
export type CommunicationStatus = 'DRAFT' | 'SCHEDULED' | 'SENT';
export type CommunicationChannel = 'IN_APP' | 'WHATSAPP' | 'PUSH';
export type TargetType = 'ALL_TENANT' | 'BUILDING' | 'UNIT' | 'ROLE';

export interface CommunicationTarget {
  id: string;
  targetType: TargetType;
  targetId?: string;
}

export interface CommunicationReceipt {
  id: string;
  userId: string;
  createdAt?: string;
  deliveredAt?: string;
  readAt?: string;
  user?: {
    id: string;
    name: string;
    email: string;
  };
}

export type CommunicationPriority = 'NORMAL' | 'URGENT';

export interface Communication {
  id: string;
  tenantId: string;
  buildingId: string;
  title: string;
  body: string;
  channel: CommunicationChannel;
  priority: CommunicationPriority;
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
  priority?: CommunicationPriority;
  targets: Array<{ targetType: TargetType; targetId?: string }>;
}

export interface UpdateCommunicationInput {
  title?: string;
  body?: string;
  channel?: CommunicationChannel;
  priority?: CommunicationPriority;
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

export interface ListCommunicationsFilters {
  status?: CommunicationStatus;
  channel?: CommunicationChannel;
  search?: string;
  sortBy?: 'createdAt' | 'sentAt' | 'scheduledAt';
  sortOrder?: 'asc' | 'desc';
}

// ============================================
// Headers Helpers
// ============================================
function validateTenantId(tenantId: string | undefined): asserts tenantId is string {
  if (!tenantId || tenantId.trim() === '') {
    throw new Error('[API] Missing tenantId - cannot make tenant-scoped API calls');
  }
}

function getAdminHeaders(tenantId: string): Record<string, string> {
  validateTenantId(tenantId);
  return {
    'X-Tenant-Id': tenantId,
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
  filters?: ListCommunicationsFilters,
): Promise<Communication[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.append('status', filters.status);
  if (filters?.channel) params.append('channel', filters.channel);
  if (filters?.search) params.append('search', filters.search);
  if (filters?.sortBy) params.append('sortBy', filters.sortBy);
  if (filters?.sortOrder) params.append('sortOrder', filters.sortOrder);

  const endpoint = `/buildings/${buildingId}/communications${params.toString() ? '?' + params.toString() : ''}`;
  logRequest('GET', endpoint);

  try {
    return await apiClient<Communication[]>({
      path: endpoint,
      method: 'GET',
      headers: getAdminHeaders(tenantId),
    });
  } catch (error) {
    const message = `Failed to list communications: ${(error as Error).message}`;
    logError(endpoint, (error as { status?: number }).status ?? 500, message);
    throw error;
  }
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

  try {
    return await apiClient<Communication>({
      path: endpoint,
      method: 'GET',
      headers: getAdminHeaders(tenantId),
    });
  } catch (error) {
    const message = `Failed to get communication: ${(error as Error).message}`;
    logError(endpoint, (error as { status?: number }).status ?? 500, message);
    throw error;
  }
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

  try {
    return await apiClient<Communication, CreateCommunicationInput>({
      path: endpoint,
      method: 'POST',
      body: input,
      headers: getAdminHeaders(tenantId),
    });
  } catch (error) {
    const message = `Failed to create communication: ${(error as Error).message}`;
    logError(endpoint, (error as { status?: number }).status ?? 500, message);
    throw error;
  }
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

  try {
    return await apiClient<Communication, UpdateCommunicationInput>({
      path: endpoint,
      method: 'PATCH',
      body: input,
      headers: getAdminHeaders(tenantId),
    });
  } catch (error) {
    const message = `Failed to update communication: ${(error as Error).message}`;
    logError(endpoint, (error as { status?: number }).status ?? 500, message);
    throw error;
  }
}

/**
 * Send/publish a communication (DRAFT → SENT or SCHEDULED)
 * If scheduledAt is provided, transitions to SCHEDULED; otherwise to SENT immediately
 */
export async function sendCommunication(
  buildingId: string,
  communicationId: string,
  tenantId: string,
  scheduledAt?: Date
): Promise<Communication> {
  const endpoint = `/buildings/${buildingId}/communications/${communicationId}/send`;
  const body: { scheduledAt?: string } = scheduledAt ? { scheduledAt: scheduledAt.toISOString() } : {};
  logRequest('POST', endpoint, body);

  try {
    return await apiClient<Communication, { scheduledAt?: string }>({
      path: endpoint,
      method: 'POST',
      body,
      headers: getAdminHeaders(tenantId),
    });
  } catch (error) {
    const message = `Failed to send communication: ${(error as Error).message}`;
    logError(endpoint, (error as { status?: number }).status ?? 500, message);
    throw error;
  }
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

  try {
    await apiClient<void>({
      path: endpoint,
      method: 'DELETE',
      headers: getAdminHeaders(tenantId),
    });
  } catch (error) {
    const message = `Failed to delete communication: ${(error as Error).message}`;
    logError(endpoint, (error as { status?: number }).status ?? 500, message);
    throw error;
  }
}

/**
 * Publish a communication with optional web push
 * This is the new MVP endpoint that replaces /send
 */
export async function publishCommunication(
  buildingId: string,
  communicationId: string,
  tenantId: string,
  sendWebPush: boolean = false
): Promise<Communication> {
  const endpoint = `/buildings/${buildingId}/communications/${communicationId}/publish`;
  const body = { sendWebPush };
  logRequest('POST', endpoint, body);

  try {
    return await apiClient<Communication, { sendWebPush: boolean }>({
      path: endpoint,
      method: 'POST',
      body,
      headers: getAdminHeaders(tenantId),
    });
  } catch (error) {
    const message = `Failed to publish communication: ${(error as Error).message}`;
    logError(endpoint, (error as { status?: number }).status ?? 500, message);
    throw error;
  }
}

// ============================================
// User Inbox Endpoints
// ============================================

export interface GetInboxFilters {
  status?: CommunicationStatus;
  buildingId?: string;
}

/**
 * Get user's inbox communications
 */
export async function getInbox(filters?: GetInboxFilters): Promise<InboxCommunication[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.append('status', filters.status);
  if (filters?.buildingId) params.append('buildingId', filters.buildingId);

  const endpoint = `/me/communications${params.toString() ? '?' + params.toString() : ''}`;
  logRequest('GET', endpoint);

  try {
    return await apiClient<InboxCommunication[]>({
      path: endpoint,
      method: 'GET',
    });
  } catch (error) {
    const message = `Failed to get inbox: ${(error as Error).message}`;
    logError(endpoint, (error as { status?: number }).status ?? 500, message);
    throw error;
  }
}

/**
 * Mark a communication as read
 */
export async function markAsRead(communicationId: string): Promise<void> {
  const endpoint = `/me/communications/${communicationId}/read`;
  logRequest('POST', endpoint);

  try {
    await apiClient<void>({
      path: endpoint,
      method: 'POST',
    });
  } catch (error) {
    const message = `Failed to mark as read: ${(error as Error).message}`;
    logError(endpoint, (error as { status?: number }).status ?? 500, message);
    throw error;
  }
}
