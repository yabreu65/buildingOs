import { apiClient } from '@/shared/lib/http/client';

interface CreateUnitGroupPayload {
  readonly buildingId: string;
  readonly name: string;
  readonly description?: string;
  readonly unitIds: readonly string[];
}

function requirePathSegment(label: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return encodeURIComponent(normalized);
}

function optionalQueryValue(label: string, value?: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }

  return normalized;
}

export const unitGroupApi = {
  /**
   * Create a new unit group
   */
  async create(tenantId: string, payload: CreateUnitGroupPayload) {
    const tenantSegment = requirePathSegment('tenantId', tenantId);
    return apiClient({
      path: `/tenants/${tenantSegment}/unit-groups`,
      method: 'POST',
      body: {
        ...payload,
        buildingId: requirePathSegment('buildingId', payload.buildingId),
        name: payload.name.trim(),
        description: payload.description?.trim(),
        unitIds: payload.unitIds.map((unitId) => requirePathSegment('unitId', unitId)),
      },
      headers: { 'tenant-id': tenantId.trim() },
    });
  },

  /**
   * Get unit group with members
   */
  async getGroup(tenantId: string, groupId: string) {
    const tenantSegment = requirePathSegment('tenantId', tenantId);
    const groupSegment = requirePathSegment('groupId', groupId);
    return apiClient({
      path: `/tenants/${tenantSegment}/unit-groups/${groupSegment}`,
      headers: { 'tenant-id': tenantId.trim() },
    });
  },

  /**
   * List unit groups for tenant (optionally filtered by building)
   */
  async list(tenantId: string, buildingId?: string) {
    const tenantSegment = requirePathSegment('tenantId', tenantId);
    const params = new URLSearchParams();
    const normalizedBuildingId = optionalQueryValue('buildingId', buildingId);
    if (normalizedBuildingId) params.append('buildingId', normalizedBuildingId);
    const query = params.toString();
    return apiClient({
      path: `/tenants/${tenantSegment}/unit-groups${query ? `?${query}` : ''}`,
      headers: { 'tenant-id': tenantId.trim() },
    });
  },

  /**
   * Add a unit to a group
   */
  async addMember(tenantId: string, groupId: string, unitId: string) {
    const tenantSegment = requirePathSegment('tenantId', tenantId);
    const groupSegment = requirePathSegment('groupId', groupId);
    const unitSegment = requirePathSegment('unitId', unitId);
    return apiClient({
      path: `/tenants/${tenantSegment}/unit-groups/${groupSegment}/members/${unitSegment}`,
      method: 'POST',
      body: { unitId: unitId.trim() },
      headers: { 'tenant-id': tenantId.trim() },
    });
  },

  /**
   * Remove a unit from a group
   */
  async removeMember(tenantId: string, groupId: string, unitId: string) {
    const tenantSegment = requirePathSegment('tenantId', tenantId);
    const groupSegment = requirePathSegment('groupId', groupId);
    const unitSegment = requirePathSegment('unitId', unitId);
    return apiClient({
      path: `/tenants/${tenantSegment}/unit-groups/${groupSegment}/members/${unitSegment}`,
      method: 'DELETE',
      headers: { 'tenant-id': tenantId.trim() },
    });
  },

  /**
   * Delete a unit group
   */
  async delete(tenantId: string, groupId: string) {
    const tenantSegment = requirePathSegment('tenantId', tenantId);
    const groupSegment = requirePathSegment('groupId', groupId);
    return apiClient({
      path: `/tenants/${tenantSegment}/unit-groups/${groupSegment}`,
      method: 'DELETE',
      headers: { 'tenant-id': tenantId.trim() },
    });
  },
};

export const allocationApi = {
  /**
   * Get allocations for an expense or income
   */
  async getForMovement(
    tenantId: string,
    expenseId?: string,
    incomeId?: string,
  ) {
    const tenantSegment = requirePathSegment('tenantId', tenantId);
    const params = new URLSearchParams();
    const normalizedExpenseId = optionalQueryValue('expenseId', expenseId);
    const normalizedIncomeId = optionalQueryValue('incomeId', incomeId);
    if (normalizedExpenseId) params.append('expenseId', normalizedExpenseId);
    if (normalizedIncomeId) params.append('incomeId', normalizedIncomeId);
    const query = params.toString();
    return apiClient({
      path: `/tenants/${tenantSegment}/allocations${query ? `?${query}` : ''}`,
      headers: { 'tenant-id': tenantId.trim() },
    });
  },
};
