const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export interface CreateLeadRequest {
  fullName: string;
  email: string;
  phoneWhatsapp?: string;
  tenantType: 'ADMINISTRADORA' | 'EDIFICIO_AUTOGESTION';
  buildingsCount?: number;
  unitsEstimate: number;
  countryCity?: string;
  message?: string;
  source?: string;
  intent?: 'DEMO' | 'CONTACT';
}

export interface LeadResponse {
  id: string;
  email: string;
  fullName: string;
  status: string;
  createdAt: string;
  message: string;
}

/**
 * Submit a new marketing lead (no authentication required)
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
