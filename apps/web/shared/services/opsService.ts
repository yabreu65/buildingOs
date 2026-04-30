import { apiClient } from '@/shared/lib/http/client';

export type OpsAlertStatus = 'OPEN' | 'ACK' | 'RESOLVED';
export type OpsAlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface OpsAlert {
  id: string;
  tenantId: string | null;
  severity: OpsAlertSeverity;
  code: string;
  message: string;
  metricsJson: Record<string, unknown>;
  window: string;
  status: OpsAlertStatus;
  createdAt: string;
  ackAt?: string | null;
  resolvedAt?: string | null;
}

export interface OpsAlertsListResponse {
  items: OpsAlert[];
  nextCursor: string | null;
}

export interface HitlMetricsResponse {
  tenantId: string | null;
  window: string;
  handoffsOpenCount: number;
  timeToAssignP95Minutes: number | null;
  timeToResolveP95Hours: number | null;
  breachedSlaCount: { assign: number; resolve: number; total: number };
  topFallbackPaths24h: Array<{ fallbackPath: string; count: number }>;
  aiHealth15m: {
    gatewayErrorRate: number | null;
    p0NoDataRate: number | null;
    cacheHitRate: number | null;
    totalEvents: number;
  };
}

class OpsService {
  async listAlerts(params: {
    status?: 'open' | 'ack' | 'resolved';
    tenantId?: string;
    limit?: number;
    cursor?: string;
  }): Promise<OpsAlertsListResponse> {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.tenantId) query.set('tenantId', params.tenantId);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.cursor) query.set('cursor', params.cursor);
    const qs = query.toString();

    return apiClient<OpsAlertsListResponse>({
      path: qs.length > 0 ? `/ops/alerts?${qs}` : '/ops/alerts',
      method: 'GET',
    });
  }

  async ackAlert(id: string): Promise<OpsAlert> {
    return apiClient<OpsAlert>({ path: `/ops/alerts/${id}/ack`, method: 'POST', body: {} });
  }

  async resolveAlert(id: string): Promise<OpsAlert> {
    return apiClient<OpsAlert>({ path: `/ops/alerts/${id}/resolve`, method: 'POST', body: {} });
  }

  async getHitlMetrics(tenantId?: string): Promise<HitlMetricsResponse> {
    const path = tenantId ? `/ops/metrics/hitl?tenantId=${encodeURIComponent(tenantId)}` : '/ops/metrics/hitl';
    return apiClient<HitlMetricsResponse>({ path, method: 'GET' });
  }
}

export const opsService = new OpsService();
