/**
 * Resident Context API
 * Thin wrappers around existing API services for the resident dashboard.
 * Uses /me/context, /units/:unitId/ledger, /me/communications, /buildings/:buildingId/tickets
 */

import { apiClient } from '@/shared/lib/http/client';
import type { UnitLedger } from '../../finance/services/finance.api';
import type { InboxCommunication } from '../../communications/services/communications.api';
import type { Ticket } from '../../tickets/services/tickets.api';

export type { UnitLedger, InboxCommunication, Ticket };

export interface ResidentContext {
  tenantId: string;
  activeBuildingId: string | null;
  activeUnitId: string | null;
}

/**
 * Get the current resident's active building/unit context.
 * @param tenantId - Tenant ID for X-Tenant-Id header
 */
export async function getResidentContext(tenantId: string): Promise<ResidentContext> {
  return apiClient<ResidentContext>({
    path: '/me/context',
    method: 'GET',
    headers: { 'X-Tenant-Id': tenantId },
  });
}

/**
 * Get ledger for a unit (charges, payments, balance).
 * Re-exports from finance.api to keep imports local to this feature.
 */
export async function getResidentLedger(unitId: string): Promise<UnitLedger> {
  return apiClient<UnitLedger>({
    path: `/units/${unitId}/ledger`,
    method: 'GET',
  });
}

/**
 * Get inbox communications (last N for the resident).
 * @param limit - Max items to return (default 3)
 */
export async function getResidentCommunications(limit = 3): Promise<InboxCommunication[]> {
  return apiClient<InboxCommunication[]>({
    path: `/me/communications?limit=${limit}`,
    method: 'GET',
  });
}

/**
 * Get tickets for a building, scoped to a specific unit.
 * Backend enforces RESIDENT scope automatically.
 * @param buildingId - Building ID
 * @param unitId - Unit ID to filter tickets
 * @param limit - Max items to return
 */
export async function getResidentTickets(
  buildingId: string,
  unitId: string,
  limit = 3,
): Promise<Ticket[]> {
  const params = new URLSearchParams({ unitId, limit: String(limit) });
  const response = await apiClient<{ tickets: Ticket[] }>({
    path: `/buildings/${buildingId}/tickets?${params.toString()}`,
    method: 'GET',
  });
  return Array.isArray(response) ? response : response?.tickets ?? [];
}
