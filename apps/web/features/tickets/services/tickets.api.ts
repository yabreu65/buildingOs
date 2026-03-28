/**
 * Tickets API Service
 * Calls the backend API endpoints for tickets and comments
 */

import { apiClient, HttpError } from '@/shared/lib/http/client';

const isDev = process.env.NODE_ENV === 'development';

// ============================================
// Types
// ============================================

/**
 * AI categorization metadata for tickets
 */
export interface AiCategorySuggestion {
  category: string;
  priority: string;
  confidence: number;
  reasoning: string;
}

export interface Ticket {
  id: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  title: string;
  description: string;
  category: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  createdBy: {
    id: string;
    name: string;
    email: string;
  };
  assignedTo: {
    id: string;
    user: {
      id: string;
      name: string;
      email: string;
    };
  } | null;
  building: {
    id: string;
    name: string;
  };
  unit: {
    id: string;
    label: string;
    code: string;
  } | null;
  comments: TicketComment[];
  // AI monetization - FASE 3
  aiSuggestedCategory?: boolean;
  aiCategorySuggestion?: AiCategorySuggestion;
}

export interface TicketComment {
  id: string;
  body: string;
  author: {
    id: string;
    name: string;
    email: string;
  };
  createdAt: string;
}

export interface CreateTicketInput {
  title: string;
  description: string;
  category: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  unitId?: string;
  assignedToMembershipId?: string;
}

export interface UpdateTicketInput {
  title?: string;
  description?: string;
  category?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  unitId?: string | null;
  assignedToMembershipId?: string | null;
}

export interface CreateCommentInput {
  body: string;
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
// Tickets API Endpoints
// ============================================

/**
 * List all tickets in a building with pagination, search, and sorting
 */
export interface TicketsListParams {
  status?: string;
  priority?: string;
  unitId?: string;
  assignedToMembership?: string;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'priority' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedTickets {
  tickets: Ticket[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function listTickets(
  buildingId: string,
  params?: TicketsListParams
): Promise<PaginatedTickets> {
  const query = new URLSearchParams();
  if (params?.status) query.append('status', params.status);
  if (params?.priority) query.append('priority', params.priority);
  if (params?.unitId) query.append('unitId', params.unitId);
  if (params?.assignedToMembership) query.append('assignedToMembership', params.assignedToMembership);
  if (params?.search) query.append('search', params.search);
  if (params?.page) query.append('page', String(params.page));
  if (params?.limit) query.append('limit', String(params.limit));
  if (params?.sortBy) query.append('sortBy', params.sortBy);
  if (params?.sortOrder) query.append('sortOrder', params.sortOrder);

  const endpoint = `/buildings/${buildingId}/tickets${query.toString() ? '?' + query.toString() : ''}`;
  logRequest('GET', endpoint);

  try {
    const data = await apiClient<PaginatedTickets>({
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
 * Get a single ticket with comments
 */
export async function getTicket(buildingId: string, ticketId: string): Promise<Ticket> {
  const endpoint = `/buildings/${buildingId}/tickets/${ticketId}`;
  logRequest('GET', endpoint);

  try {
    const data = await apiClient<Ticket>({
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
 * Create a new ticket
 */
export async function createTicket(
  buildingId: string,
  input: CreateTicketInput
): Promise<Ticket> {
  const endpoint = `/buildings/${buildingId}/tickets`;
  logRequest('POST', endpoint, input);

  try {
    const data = await apiClient<Ticket, CreateTicketInput>({
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
 * Update a ticket
 */
export async function updateTicket(
  buildingId: string,
  ticketId: string,
  input: UpdateTicketInput
): Promise<Ticket> {
  const endpoint = `/buildings/${buildingId}/tickets/${ticketId}`;
  logRequest('PATCH', endpoint, input);

  try {
    const data = await apiClient<Ticket, UpdateTicketInput>({
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
 * Add a comment to a ticket
 */
export async function addComment(
  buildingId: string,
  ticketId: string,
  input: CreateCommentInput
): Promise<TicketComment> {
  const endpoint = `/buildings/${buildingId}/tickets/${ticketId}/comments`;
  logRequest('POST', endpoint, input);

  try {
    const data = await apiClient<TicketComment, CreateCommentInput>({
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
 * Get all comments for a ticket
 */
export async function getComments(
  buildingId: string,
  ticketId: string
): Promise<TicketComment[]> {
  const endpoint = `/buildings/${buildingId}/tickets/${ticketId}/comments`;
  logRequest('GET', endpoint);

  try {
    const data = await apiClient<TicketComment[]>({
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
 * Get AI-suggested replies for a ticket
 * Used for smart reply suggestions when responding to tickets
 *
 * Returns 3 professional suggested replies based on ticket content
 */
export async function getTicketReplySuggestions(
  tenantId: string,
  ticketId: string,
  title: string,
  description: string
): Promise<{ replies: string[] }> {
  const endpoint = `/tenants/${tenantId}/assistant/ticket-replies`;
  logRequest('POST', endpoint, { ticketId, title, description });

  try {
    const data = await apiClient<{ replies: string[] }, { ticketId: string; title: string; description: string }>({
      path: endpoint,
      method: 'POST',
      body: { ticketId, title, description },
    });
    return data;
  } catch (error) {
    const httpError = error instanceof HttpError ? error : new HttpError(500, 'Unknown', String(error));
    logError(endpoint, httpError.status, httpError.message);
    throw error;
  }
}
