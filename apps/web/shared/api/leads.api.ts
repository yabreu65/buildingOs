/**
 * Public Leads API - no authentication required
 */

export interface CreateLeadRequest {
  fullName: string;
  email: string;
  phoneWhatsapp?: string;
  tenantType: 'ADMINISTRADORA' | 'EDIFICIO_AUTOGESTION';
  buildingsCount?: number;
  unitsEstimate?: number;
  countryCity?: string;
  message?: string;
  source?: string;
  intent?: 'DEMO' | 'CONTACT' | 'SIGNUP';
}

export interface LeadResponse {
  id: string;
  email: string;
  fullName: string;
  status: string;
  createdAt: string;
  message: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/**
 * Submit a new marketing lead (no authentication required)
 * Note: This uses direct fetch because it's a public endpoint that doesn't need auth
 */
export async function submitLead(data: CreateLeadRequest): Promise<LeadResponse> {
  const response = await fetch(`${API_URL}/leads/public`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to submit lead' }));
    throw new Error(error.message || 'Failed to submit lead');
  }

  return response.json();
}

/**
 * Register a new user for SIGNUP flow (no authentication required)
 * Creates a new tenant and sends invitation email with password setup link
 */
export async function registerUser(data: {
  fullName: string;
  email: string;
  tenantName: string;
  tenantType: 'ADMINISTRADORA' | 'EDIFICIO_AUTOGESTION';
  phoneWhatsapp?: string;
}): Promise<LeadResponse> {
  const response = await fetch(`${API_URL}/leads/public/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to register' }));
    throw new Error(error.message || 'Failed to register');
  }

  return response.json();
}
