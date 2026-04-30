export type OpsAlertStatusFilter = 'open' | 'ack' | 'resolved';

export type OpsAlertSeverityValue = 'info' | 'warning' | 'critical';

export type OpsActorContext = {
  userId: string;
  isSuperAdmin: boolean;
  tenantId?: string;
  roles: string[];
};

export type OpsAlertsListQuery = {
  status?: string;
  tenantId?: string;
  cursor?: string;
  limit?: number;
};

export type HitlMetricsSnapshot = {
  tenantId: string | null;
  window: string;
  handoffsOpenCount: number;
  timeToAssignP95Minutes: number | null;
  timeToResolveP95Hours: number | null;
  breachedSlaCount: {
    assign: number;
    resolve: number;
    total: number;
  };
  topFallbackPaths24h: Array<{ fallbackPath: string; count: number }>;
  aiHealth15m: {
    gatewayErrorRate: number | null;
    p0NoDataRate: number | null;
    cacheHitRate: number | null;
    totalEvents: number;
  };
};
