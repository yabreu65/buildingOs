import { apiClient } from '@/shared/lib/http/client';

export interface LiquidationDraft {
  liquidation: {
    id: string;
    tenantId: string;
    buildingId: string;
    period: string;
    status: 'DRAFT' | 'REVIEWED' | 'PUBLISHED' | 'CANCELED';
    baseCurrency: string;
    totalAmountMinor: number;
    unitCount: number;
    generatedAt: string;
  };
  expenses: Array<{
    id: string;
    categoryName: string;
    vendorName: string | null;
    amountMinor: number;
    currencyCode: string;
    invoiceDate: string;
    description: string | null;
  }>;
  chargesPreview: Array<{
    unitId: string;
    unitCode: string;
    unitLabel: string | null;
    areaM2: number;
    amountMinor: number;
  }>;
}

export interface LiquidationDetail extends LiquidationDraft {
  reviewedAt: string | null;
  publishedAt: string | null;
  canceledAt: string | null;
}

export const liquidationApi = {
  /**
   * Create a draft liquidation for a building/period
   */
  async createDraft(tenantId: string, payload: {
    buildingId: string;
    period: string;
    baseCurrency: string;
  }): Promise<LiquidationDraft> {
    return apiClient({
      path: `/tenants/${tenantId}/liquidations`,
      method: 'POST',
      body: payload,
      headers: { 'tenant-id': tenantId },
    });
  },

  /**
   * Get liquidation detail with expenses and charges
   */
  async getDetail(tenantId: string, liquidationId: string): Promise<LiquidationDetail> {
    return apiClient({
      path: `/tenants/${tenantId}/liquidations/${liquidationId}`,
      headers: { 'tenant-id': tenantId },
    });
  },

  /**
   * Review a liquidation (DRAFT → REVIEWED)
   */
  async review(tenantId: string, liquidationId: string): Promise<LiquidationDetail> {
    return apiClient({
      path: `/tenants/${tenantId}/liquidations/${liquidationId}/review`,
      method: 'PATCH',
      body: {},
      headers: { 'tenant-id': tenantId },
    });
  },

  /**
   * Publish a liquidation (REVIEWED → PUBLISHED with charges)
   */
  async publish(
    tenantId: string,
    liquidationId: string,
    dueDate: string,
  ): Promise<LiquidationDetail> {
    return apiClient({
      path: `/tenants/${tenantId}/liquidations/${liquidationId}/publish`,
      method: 'PATCH',
      body: { dueDate },
      headers: { 'tenant-id': tenantId },
    });
  },

  /**
   * Cancel a liquidation
   */
  async cancel(tenantId: string, liquidationId: string): Promise<LiquidationDetail> {
    return apiClient({
      path: `/tenants/${tenantId}/liquidations/${liquidationId}/cancel`,
      method: 'PATCH',
      body: {},
      headers: { 'tenant-id': tenantId },
    });
  },
};

export const unitGroupApi = {
  /**
   * Create a new unit group
   */
  async create(tenantId: string, payload: {
    buildingId: string;
    name: string;
    description?: string;
    unitIds: string[];
  }) {
    return apiClient({
      path: `/tenants/${tenantId}/unit-groups`,
      method: 'POST',
      body: payload,
      headers: { 'tenant-id': tenantId },
    });
  },

  /**
   * Get unit group with members
   */
  async getGroup(tenantId: string, groupId: string) {
    return apiClient({
      path: `/tenants/${tenantId}/unit-groups/${groupId}`,
      headers: { 'tenant-id': tenantId },
    });
  },

  /**
   * List unit groups for tenant (optionally filtered by building)
   */
  async list(tenantId: string, buildingId?: string) {
    const params = new URLSearchParams();
    if (buildingId) params.append('buildingId', buildingId);
    const query = params.toString();
    return apiClient({
      path: `/tenants/${tenantId}/unit-groups${query ? `?${query}` : ''}`,
      headers: { 'tenant-id': tenantId },
    });
  },

  /**
   * Add a unit to a group
   */
  async addMember(tenantId: string, groupId: string, unitId: string) {
    return apiClient({
      path: `/tenants/${tenantId}/unit-groups/${groupId}/members`,
      method: 'POST',
      body: { unitId },
      headers: { 'tenant-id': tenantId },
    });
  },

  /**
   * Remove a unit from a group
   */
  async removeMember(tenantId: string, groupId: string, unitId: string) {
    return apiClient({
      path: `/tenants/${tenantId}/unit-groups/${groupId}/members/${unitId}`,
      method: 'DELETE',
      headers: { 'tenant-id': tenantId },
    });
  },

  /**
   * Delete a unit group
   */
  async delete(tenantId: string, groupId: string) {
    return apiClient({
      path: `/tenants/${tenantId}/unit-groups/${groupId}`,
      method: 'DELETE',
      headers: { 'tenant-id': tenantId },
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
    const params = new URLSearchParams();
    if (expenseId) params.append('expenseId', expenseId);
    if (incomeId) params.append('incomeId', incomeId);
    const query = params.toString();
    return apiClient({
      path: `/tenants/${tenantId}/allocations${query ? `?${query}` : ''}`,
      headers: { 'tenant-id': tenantId },
    });
  },
};
