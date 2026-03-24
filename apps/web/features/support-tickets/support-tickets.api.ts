'use client';

import { apiClient } from '@/shared/lib/http/client';

export interface SupportTicket {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  category: 'BILLING' | 'FEATURE_REQUEST' | 'BUG_REPORT' | 'ACCOUNT_ISSUE' | 'TECHNICAL_SUPPORT' | 'OTHER';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  createdBy: { id: string; name: string; email: string };
  assignedTo?: { id: string; name: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
  closedAt?: string | null;
  comments?: SupportTicketComment[];
}

export interface SupportTicketComment {
  id: string;
  supportTicketId: string;
  body: string;
  author: { id: string; name: string; email: string };
  createdAt: string;
}

// ============================================================================
// SUPER_ADMIN ENDPOINTS
// ============================================================================

export async function listAllSupportTickets(
  params?: {
    status?: string;
    category?: string;
    priority?: string;
    skip?: number;
    take?: number;
  },
) {
  const query = new URLSearchParams();

  if (params?.status) query.append('status', params.status);
  if (params?.category) query.append('category', params.category);
  if (params?.priority) query.append('priority', params.priority);
  if (params?.skip) query.append('skip', params.skip.toString());
  if (params?.take) query.append('take', params.take.toString());

  return apiClient({
    path: `/super-admin/support?${query}`,
    method: 'GET',
  });
}

export async function getSupportTicket(id: string) {
  return apiClient({
    path: `/super-admin/support/${id}`,
    method: 'GET',
  });
}

export async function updateSupportTicket(
  id: string,
  data: {
    title?: string;
    description?: string;
    priority?: string;
  },
) {
  return apiClient({
    path: `/super-admin/support/${id}`,
    method: 'PATCH',
    body: data,
  });
}

export async function updateSupportTicketStatus(
  id: string,
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED',
) {
  return apiClient({
    path: `/super-admin/support/${id}/status`,
    method: 'PATCH',
    body: { status },
  });
}

export async function assignSupportTicket(
  id: string,
  assignedToUserId?: string,
) {
  return apiClient({
    path: `/super-admin/support/${id}/assign`,
    method: 'PATCH',
    body: { assignedToUserId },
  });
}

export async function closeSupportTicket(id: string) {
  return apiClient({
    path: `/super-admin/support/${id}`,
    method: 'DELETE',
  });
}

export async function addSupportTicketComment(
  id: string,
  body: string,
) {
  return apiClient({
    path: `/super-admin/support/${id}/comments`,
    method: 'POST',
    body: { body },
  });
}

// ============================================================================
// TENANT ADMIN ENDPOINTS
// ============================================================================

export async function listTenantSupportTickets(
  tenantId: string,
  params?: {
    status?: string;
    category?: string;
    skip?: number;
    take?: number;
  },
) {
  const query = new URLSearchParams();

  if (params?.status) query.append('status', params.status);
  if (params?.category) query.append('category', params.category);
  if (params?.skip) query.append('skip', params.skip.toString());
  if (params?.take) query.append('take', params.take.toString());

  return apiClient({
    path: `/${tenantId}/support?${query}`,
    method: 'GET',
  });
}

export async function createSupportTicket(
  tenantId: string,
  data: {
    title: string;
    description: string;
    category?: string;
    priority?: string;
  },
) {
  return apiClient({
    path: `/${tenantId}/support`,
    method: 'POST',
    body: data,
  });
}

export async function getTenantSupportTicket(
  tenantId: string,
  id: string,
) {
  return apiClient({
    path: `/${tenantId}/support/${id}`,
    method: 'GET',
  });
}

export async function updateTenantSupportTicket(
  tenantId: string,
  id: string,
  data: {
    title?: string;
    description?: string;
    priority?: string;
  },
) {
  return apiClient({
    path: `/${tenantId}/support/${id}`,
    method: 'PATCH',
    body: data,
  });
}

export async function addTenantSupportTicketComment(
  tenantId: string,
  id: string,
  body: string,
) {
  return apiClient({
    path: `/${tenantId}/support/${id}/comments`,
    method: 'POST',
    body: { body },
  });
}
