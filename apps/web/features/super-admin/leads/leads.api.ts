/**
 * Leads API Service
 * Manages super-admin leads operations
 */

import { apiClient } from '@/shared/lib/http/client';

export interface Lead {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  tenantType: 'ADMINISTRADORA' | 'EDIFICIO_AUTOGESTION';
  buildingsCount?: number;
  unitsEstimate?: number;
  location?: string;
  message?: string;
  source?: string;
  status: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'DISQUALIFIED';
  notes?: string;
  createdAt: string;
  updatedAt: string;
  convertedTenantId?: string;
}

export interface ListLeadsResponse {
  data: Lead[];
  total: number;
  page: number;
}

export interface UpdateLeadDto {
  status?: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'DISQUALIFIED';
  notes?: string;
}

export interface ConvertLeadDto {
  tenantName: string;
  tenantType?: 'ADMINISTRADORA' | 'EDIFICIO_AUTOGESTION';
  ownerEmail?: string;
  ownerFullName?: string;
  planId?: string;
  createDemoData?: boolean;
}

export interface ConvertLeadResponse {
  tenantId: string;
  ownerUserId: string;
  inviteSent: boolean;
}

/**
 * List all leads with filtering and pagination
 */
export async function listLeads(filters?: {
  status?: string;
  email?: string;
  source?: string;
  skip?: number;
  take?: number;
}): Promise<ListLeadsResponse> {
  const params = new URLSearchParams();
  if (filters?.status) params.append('status', filters.status);
  if (filters?.email) params.append('email', filters.email);
  if (filters?.source) params.append('source', filters.source);
  if (filters?.skip !== undefined) params.append('skip', String(filters.skip));
  if (filters?.take !== undefined) params.append('take', String(filters.take));

  const qs = params.toString();
  return apiClient<ListLeadsResponse>({
    path: `/leads/admin${qs ? '?' + qs : ''}`,
    method: 'GET',
  });
}

/**
 * Get a single lead by ID
 */
export async function getLead(id: string): Promise<Lead> {
  return apiClient<Lead>({
    path: `/leads/admin/${id}`,
    method: 'GET',
  });
}

/**
 * Update lead status and notes
 */
export async function updateLead(
  id: string,
  dto: UpdateLeadDto
): Promise<Lead> {
  return apiClient<Lead, UpdateLeadDto>({
    path: `/leads/admin/${id}`,
    method: 'PATCH',
    body: dto,
  });
}

/**
 * Convert lead to customer (creates tenant + owner)
 */
export async function convertLead(
  id: string,
  dto: ConvertLeadDto
): Promise<ConvertLeadResponse> {
  return apiClient<ConvertLeadResponse, ConvertLeadDto>({
    path: `/leads/admin/${id}/convert`,
    method: 'POST',
    body: dto,
  });
}

/**
 * Delete a lead
 */
export async function deleteLead(id: string): Promise<void> {
  await apiClient<void>({
    path: `/leads/admin/${id}`,
    method: 'DELETE',
  });
}
