import { apiClient } from '@/shared/lib/http/client';

export interface TenantAnalyticsResponse {
  month: string;
  usage: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostCents: number;
    budgetCents: number;
    percentUsed: number;
  };
  efficiency: {
    totalInteractions: number;
    cacheHits: number;
    cacheHitRate: number;
    smallCalls: number;
    bigCalls: number;
    mockCalls: number;
  };
  adoption: {
    uniqueUsers: number;
    interactionsByPage: Array<{ page: string; count: number }>;
  };
  templates: Array<{ templateKey: string; runs: number }>;
  actions: Array<{ actionType: string; clicks: number }>;
}

export interface TenantSummaryItem {
  tenantId: string;
  name: string;
  planId: string;
  calls: number;
  estimatedCostCents: number;
  budgetCents: number;
  percentUsed: number;
  atRisk: boolean;
}

export interface CreateActionEventDto {
  actionType: string;
  source: string;
  page: string;
  buildingId?: string;
  unitId?: string;
  interactionId?: string;
}

export const analyticsApi = {
  /**
   * Track a click on suggested action (fire-and-forget)
   */
  async trackActionEvent(
    tenantId: string,
    dto: CreateActionEventDto,
  ): Promise<void> {
    if (!tenantId) return;
    try {
      await apiClient<{ success: boolean }, CreateActionEventDto>({
        path: `/tenants/${tenantId}/assistant/action-events`,
        method: 'POST',
        body: dto,
      });
    } catch (error) {
      // Fire-and-forget: never fails
      console.error('Failed to track AI action event:', error);
    }
  },

  /**
   * Get AI analytics for a tenant
   */
  async getTenantAnalytics(
    tenantId: string,
    month?: string,
  ): Promise<TenantAnalyticsResponse> {
    if (!tenantId) throw new Error('tenantId required');
    const params = new URLSearchParams();
    if (month) params.append('month', month);
    const qs = params.toString();
    return apiClient<TenantAnalyticsResponse>({
      path: `/tenants/${tenantId}/assistant/analytics${qs ? '?' + qs : ''}`,
      method: 'GET',
    });
  },

  /**
   * Get AI analytics for all tenants (super-admin)
   */
  async getAllTenantsAnalytics(month?: string): Promise<TenantSummaryItem[]> {
    const params = new URLSearchParams();
    if (month) params.append('month', month);
    const qs = params.toString();
    return apiClient<TenantSummaryItem[]>({
      path: `/super-admin/ai/tenants${qs ? '?' + qs : ''}`,
      method: 'GET',
    });
  },

  /**
   * Get detailed AI analytics for a tenant (super-admin)
   */
  async getTenantDetailedAnalytics(
    tenantId: string,
    month?: string,
  ) {
    if (!tenantId) throw new Error('tenantId required');
    const params = new URLSearchParams();
    if (month) params.append('month', month);
    const qs = params.toString();
    return apiClient({
      path: `/super-admin/ai/tenants/${tenantId}${qs ? '?' + qs : ''}`,
      method: 'GET',
    });
  },
};
