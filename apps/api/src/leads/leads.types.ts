import { Lead } from '@prisma/client';

/**
 * Lead response for GET operations
 */
export type LeadResponse = Lead & {
  convertedTenant?: {
    id: string;
    name: string;
    type: string;
    subscription: {
      id: string;
      status: string;
      planId: string;
      plan: {
        planId: string;
        name: string;
      };
    } | null;
  } | null;
};

/**
 * Leads list response
 */
export interface LeadsListResponse {
  data: Lead[];
  total: number;
}

/**
 * Lead filter input
 */
export interface LeadFilter {
  status?: string;
  email?: string;
  source?: string;
  skip?: number;
  take?: number;
}

/**
 * Self-registration response
 */
export interface SelfRegisterResponse {
  success: boolean;
}
