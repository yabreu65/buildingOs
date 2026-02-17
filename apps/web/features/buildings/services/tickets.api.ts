/**
 * Tickets API Service
 * Calls the backend API endpoints for tickets and comments
 */

import { getToken } from '@/features/auth/session.storage';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const isDev = process.env.NODE_ENV === 'development';

// ============================================
// Types
// ============================================
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
// Tickets API Endpoints
// ============================================

/**
 * List all tickets in a building
 */
export async function listTickets(
  buildingId: string,
  filters?: {
    status?: string;
    priority?: string;
    unitId?: string;
    assignedToMembership?: string;
  }
): Promise<Ticket[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.append('status', filters.status);
  if (filters?.priority) params.append('priority', filters.priority);
  if (filters?.unitId) params.append('unitId', filters.unitId);
  if (filters?.assignedToMembership) params.append('assignedToMembership', filters.assignedToMembership);

  const endpoint = `/buildings/${buildingId}/tickets${params.toString() ? '?' + params.toString() : ''}`;
  logRequest('GET', endpoint);

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const message = `Failed to list tickets: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  const data = await response.json();
  return data;
}

/**
 * Get a single ticket with comments
 */
export async function getTicket(buildingId: string, ticketId: string): Promise<Ticket> {
  const endpoint = `/buildings/${buildingId}/tickets/${ticketId}`;
  logRequest('GET', endpoint);

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const message = `Failed to get ticket: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  const data = await response.json();
  return data;
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

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const message = `Failed to create ticket: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  const data = await response.json();
  return data;
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

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const message = `Failed to update ticket: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  const data = await response.json();
  return data;
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

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const message = `Failed to add comment: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  const data = await response.json();
  return data;
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

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const message = `Failed to get comments: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  const data = await response.json();
  return data;
}
