'use client';

import { getToken } from '@/features/auth/session.storage';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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
  const token = getToken();
  const query = new URLSearchParams();

  if (params?.status) query.append('status', params.status);
  if (params?.category) query.append('category', params.category);
  if (params?.priority) query.append('priority', params.priority);
  if (params?.skip) query.append('skip', params.skip.toString());
  if (params?.take) query.append('take', params.take.toString());

  const response = await fetch(`${API_URL}/super-admin/support?${query}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch support tickets: ${response.statusText}`);
  }

  return response.json();
}

export async function getSupportTicket(id: string) {
  const token = getToken();

  const response = await fetch(`${API_URL}/super-admin/support/${id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch support ticket: ${response.statusText}`);
  }

  return response.json();
}

export async function updateSupportTicket(
  id: string,
  data: {
    title?: string;
    description?: string;
    priority?: string;
  },
) {
  const token = getToken();

  const response = await fetch(`${API_URL}/super-admin/support/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Failed to update support ticket: ${response.statusText}`);
  }

  return response.json();
}

export async function updateSupportTicketStatus(
  id: string,
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED',
) {
  const token = getToken();

  const response = await fetch(`${API_URL}/super-admin/support/${id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update ticket status: ${response.statusText}`);
  }

  return response.json();
}

export async function assignSupportTicket(
  id: string,
  assignedToUserId?: string,
) {
  const token = getToken();

  const response = await fetch(`${API_URL}/super-admin/support/${id}/assign`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ assignedToUserId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to assign support ticket: ${response.statusText}`);
  }

  return response.json();
}

export async function closeSupportTicket(id: string) {
  const token = getToken();

  const response = await fetch(`${API_URL}/super-admin/support/${id}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to close support ticket: ${response.statusText}`);
  }

  return response.json();
}

export async function addSupportTicketComment(
  id: string,
  body: string,
) {
  const token = getToken();

  const response = await fetch(`${API_URL}/super-admin/support/${id}/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    throw new Error(`Failed to add comment: ${response.statusText}`);
  }

  return response.json();
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
  const token = getToken();
  const query = new URLSearchParams();

  if (params?.status) query.append('status', params.status);
  if (params?.category) query.append('category', params.category);
  if (params?.skip) query.append('skip', params.skip.toString());
  if (params?.take) query.append('take', params.take.toString());

  const response = await fetch(`${API_URL}/${tenantId}/support?${query}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch support tickets: ${response.statusText}`);
  }

  return response.json();
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
  const token = getToken();

  const response = await fetch(`${API_URL}/${tenantId}/support`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Failed to create support ticket: ${response.statusText}`);
  }

  return response.json();
}

export async function getTenantSupportTicket(
  tenantId: string,
  id: string,
) {
  const token = getToken();

  const response = await fetch(`${API_URL}/${tenantId}/support/${id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch support ticket: ${response.statusText}`);
  }

  return response.json();
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
  const token = getToken();

  const response = await fetch(`${API_URL}/${tenantId}/support/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Failed to update support ticket: ${response.statusText}`);
  }

  return response.json();
}

export async function addTenantSupportTicketComment(
  tenantId: string,
  id: string,
  body: string,
) {
  const token = getToken();

  const response = await fetch(`${API_URL}/${tenantId}/support/${id}/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    throw new Error(`Failed to add comment: ${response.statusText}`);
  }

  return response.json();
}
