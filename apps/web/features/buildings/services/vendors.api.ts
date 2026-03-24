/**
 * Vendors API Service
 * Calls the backend API endpoints for vendors, assignments, quotes, and work orders
 */

import { apiClient } from '@/shared/lib/http/client';

const isDev = process.env.NODE_ENV === 'development';

// ============================================
// Types
// ============================================
export interface Vendor {
  id: string;
  tenantId: string;
  name: string;
  taxId?: string;
  email?: string;
  phone?: string;
  notes?: string;
  createdAt: string;
}

export interface VendorAssignment {
  id: string;
  vendorId: string;
  buildingId: string;
  serviceType: string;
  tenantId: string;
  createdAt: string;
  vendor?: Vendor;
}

export type QuoteStatus = 'REQUESTED' | 'RECEIVED' | 'APPROVED' | 'REJECTED';

export interface Quote {
  id: string;
  tenantId: string;
  buildingId: string;
  vendorId: string;
  ticketId?: string;
  amount: number;
  currency: string;
  status: QuoteStatus;
  fileId?: string;
  notes?: string;
  createdAt: string;
  vendor?: Vendor;
  ticket?: { id: string; title: string };
}

export type WorkOrderStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export interface WorkOrder {
  id: string;
  tenantId: string;
  buildingId: string;
  ticketId?: string;
  vendorId?: string;
  assignedToMembershipId?: string;
  status: WorkOrderStatus;
  description?: string;
  scheduledFor?: string;
  closedAt?: string;
  createdAt: string;
  vendor?: Vendor;
  ticket?: { id: string; title: string };
  assignedTo?: { user: { id: string; name: string } };
}

// DTOs
export interface CreateVendorInput {
  name: string;
  taxId?: string;
  email?: string;
  phone?: string;
  notes?: string;
}

export interface CreateVendorAssignmentInput {
  vendorId: string;
  serviceType: string;
}

export interface CreateQuoteInput {
  vendorId: string;
  ticketId?: string;
  amount: number;
  currency: string;
  notes?: string;
}

export interface UpdateQuoteInput {
  status?: QuoteStatus;
  amount?: number;
  notes?: string;
}

export interface CreateWorkOrderInput {
  ticketId?: string;
  vendorId?: string;
  assignedToMembershipId?: string;
  description?: string;
  scheduledFor?: string;
}

export interface UpdateWorkOrderInput {
  status?: WorkOrderStatus;
  description?: string;
  scheduledFor?: string;
  assignedToMembershipId?: string;
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
// Vendors API Endpoints
// ============================================

/**
 * List all vendors (tenant-level)
 */
export async function listAllVendors(): Promise<Vendor[]> {
  const endpoint = '/vendors';
  logRequest('GET', endpoint);

  try {
    return await apiClient<Vendor[]>({
      path: endpoint,
      method: 'GET',
    });
  } catch (error) {
    const message = `Failed to list vendors: ${(error as Error).message}`;
    logError(endpoint, 500, message);
    throw error;
  }
}

/**
 * Create a new vendor
 */
export async function createVendor(input: CreateVendorInput): Promise<Vendor> {
  const endpoint = '/vendors';
  logRequest('POST', endpoint, input);

  try {
    return await apiClient<Vendor, CreateVendorInput>({
      path: endpoint,
      method: 'POST',
      body: input,
    });
  } catch (error) {
    const message = `Failed to create vendor: ${(error as Error).message}`;
    logError(endpoint, 500, message);
    throw error;
  }
}

// ============================================
// Vendor Assignments API Endpoints
// ============================================

/**
 * List vendor assignments for a building
 */
export async function listBuildingVendors(buildingId: string): Promise<VendorAssignment[]> {
  const endpoint = `/buildings/${buildingId}/vendors/assignments`;
  logRequest('GET', endpoint);

  try {
    return await apiClient<VendorAssignment[]>({
      path: endpoint,
      method: 'GET',
    });
  } catch (error) {
    const message = `Failed to list vendor assignments: ${(error as Error).message}`;
    logError(endpoint, 500, message);
    throw error;
  }
}

/**
 * Create a vendor assignment for a building
 */
export async function createVendorAssignment(
  buildingId: string,
  input: CreateVendorAssignmentInput
): Promise<VendorAssignment> {
  const endpoint = `/buildings/${buildingId}/vendors/assignments`;
  logRequest('POST', endpoint, input);

  try {
    return await apiClient<VendorAssignment, CreateVendorAssignmentInput>({
      path: endpoint,
      method: 'POST',
      body: input,
    });
  } catch (error) {
    const message = `Failed to create vendor assignment: ${(error as Error).message}`;
    logError(endpoint, 500, message);
    throw error;
  }
}

/**
 * Delete a vendor assignment
 */
export async function deleteVendorAssignment(
  buildingId: string,
  assignmentId: string
): Promise<void> {
  const endpoint = `/buildings/${buildingId}/vendors/assignments/${assignmentId}`;
  logRequest('DELETE', endpoint);

  try {
    await apiClient<void>({
      path: endpoint,
      method: 'DELETE',
    });
  } catch (error) {
    const message = `Failed to delete vendor assignment: ${(error as Error).message}`;
    logError(endpoint, 500, message);
    throw error;
  }
}

// ============================================
// Quotes API Endpoints
// ============================================

/**
 * List quotes for a building
 */
export async function listQuotes(
  buildingId: string,
  filters?: {
    status?: string;
    ticketId?: string;
    vendorId?: string;
  }
): Promise<Quote[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.append('status', filters.status);
  if (filters?.ticketId) params.append('ticketId', filters.ticketId);
  if (filters?.vendorId) params.append('vendorId', filters.vendorId);

  const endpoint = `/buildings/${buildingId}/quotes${params.toString() ? '?' + params.toString() : ''}`;
  logRequest('GET', endpoint);

  try {
    return await apiClient<Quote[]>({
      path: endpoint,
      method: 'GET',
    });
  } catch (error) {
    const message = `Failed to list quotes: ${(error as Error).message}`;
    logError(endpoint, 500, message);
    throw error;
  }
}

/**
 * Create a new quote
 */
export async function createQuote(buildingId: string, input: CreateQuoteInput): Promise<Quote> {
  const endpoint = `/buildings/${buildingId}/quotes`;
  logRequest('POST', endpoint, input);

  try {
    return await apiClient<Quote, CreateQuoteInput>({
      path: endpoint,
      method: 'POST',
      body: input,
    });
  } catch (error) {
    const message = `Failed to create quote: ${(error as Error).message}`;
    logError(endpoint, 500, message);
    throw error;
  }
}

/**
 * Update a quote
 */
export async function updateQuote(
  buildingId: string,
  quoteId: string,
  input: UpdateQuoteInput
): Promise<Quote> {
  const endpoint = `/buildings/${buildingId}/quotes/${quoteId}`;
  logRequest('PATCH', endpoint, input);

  try {
    return await apiClient<Quote, UpdateQuoteInput>({
      path: endpoint,
      method: 'PATCH',
      body: input,
    });
  } catch (error) {
    const message = `Failed to update quote: ${(error as Error).message}`;
    logError(endpoint, 500, message);
    throw error;
  }
}

// ============================================
// Work Orders API Endpoints
// ============================================

/**
 * List work orders for a building
 */
export async function listWorkOrders(
  buildingId: string,
  filters?: {
    status?: string;
    ticketId?: string;
  }
): Promise<WorkOrder[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.append('status', filters.status);
  if (filters?.ticketId) params.append('ticketId', filters.ticketId);

  const endpoint = `/buildings/${buildingId}/work-orders${params.toString() ? '?' + params.toString() : ''}`;
  logRequest('GET', endpoint);

  try {
    return await apiClient<WorkOrder[]>({
      path: endpoint,
      method: 'GET',
    });
  } catch (error) {
    const message = `Failed to list work orders: ${(error as Error).message}`;
    logError(endpoint, 500, message);
    throw error;
  }
}

/**
 * Create a new work order
 */
export async function createWorkOrder(
  buildingId: string,
  input: CreateWorkOrderInput
): Promise<WorkOrder> {
  const endpoint = `/buildings/${buildingId}/work-orders`;
  logRequest('POST', endpoint, input);

  try {
    return await apiClient<WorkOrder, CreateWorkOrderInput>({
      path: endpoint,
      method: 'POST',
      body: input,
    });
  } catch (error) {
    const message = `Failed to create work order: ${(error as Error).message}`;
    logError(endpoint, 500, message);
    throw error;
  }
}

/**
 * Update a work order
 */
export async function updateWorkOrder(
  buildingId: string,
  workOrderId: string,
  input: UpdateWorkOrderInput
): Promise<WorkOrder> {
  const endpoint = `/buildings/${buildingId}/work-orders/${workOrderId}`;
  logRequest('PATCH', endpoint, input);

  try {
    return await apiClient<WorkOrder, UpdateWorkOrderInput>({
      path: endpoint,
      method: 'PATCH',
      body: input,
    });
  } catch (error) {
    const message = `Failed to update work order: ${(error as Error).message}`;
    logError(endpoint, 500, message);
    throw error;
  }
}
