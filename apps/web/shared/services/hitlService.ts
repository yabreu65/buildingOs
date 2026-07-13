import { apiClient } from '@/shared/lib/http/client';

export type HitlStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'DISMISSED'
  | 'PENDING'
  | 'NOTIFIED'
  | 'FAILED';

export interface HitlHandoff {
  id: string;
  tenantId: string;
  userId: string;
  assignedToUserId?: string | null;
  role: string;
  question: string;
  traceId: string;
  resolvedLevel: string;
  fallbackPath: string;
  gatewayOutcome: string;
  contextJson: Record<string, unknown>;
  createdAt: string;
  assignedAt?: string | null;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
  status: HitlStatus;
  responseRegistered?: boolean;
  messageId?: string;
  notifyEnqueued?: boolean;
}

export interface HitlAuditRow {
  id: string;
  action: string;
  actorUserId: string;
  createdAt: string;
}

export interface HitlHandoffDetail extends HitlHandoff {
  audits: HitlAuditRow[];
}

export interface HitlListResponse {
  items: HitlHandoff[];
  nextCursor: string | null;
}

class HitlService {
  async list(params: {
    status?: 'open' | 'in_progress' | 'resolved' | 'dismissed';
    tenantId?: string;
    fallbackPath?: string;
    cursor?: string;
    limit?: number;
  }): Promise<HitlListResponse> {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.tenantId) query.set('tenantId', params.tenantId);
    if (params.fallbackPath) query.set('fallbackPath', params.fallbackPath);
    if (params.cursor) query.set('cursor', params.cursor);
    if (params.limit !== undefined) query.set('limit', String(params.limit));

    const qs = query.toString();
    const path = qs.length > 0 ? `/ops/hitl/handoffs?${qs}` : '/ops/hitl/handoffs';

    return apiClient<HitlListResponse>({
      path,
      method: 'GET',
    });
  }

  async getById(id: string): Promise<HitlHandoffDetail> {
    return apiClient<HitlHandoffDetail>({
      path: `/ops/hitl/handoffs/${id}`,
      method: 'GET',
    });
  }

  async assignToMe(id: string): Promise<HitlHandoff> {
    return apiClient<HitlHandoff, Record<string, never>>({
      path: `/ops/hitl/handoffs/${id}/assign`,
      method: 'POST',
      body: {},
    });
  }

  async resolve(
    id: string,
    resolutionNote: string,
    notifyUser?: boolean,
  ): Promise<HitlHandoff> {
    return apiClient<HitlHandoff, { resolutionNote: string; notifyUser?: boolean }>({
      path: `/ops/hitl/handoffs/${id}/resolve`,
      method: 'POST',
      body: { resolutionNote, ...(notifyUser ? { notifyUser: true } : {}) },
    });
  }

  async dismiss(id: string): Promise<HitlHandoff> {
    return apiClient<HitlHandoff, Record<string, never>>({
      path: `/ops/hitl/handoffs/${id}/dismiss`,
      method: 'POST',
      body: {},
    });
  }
}

export const hitlService = new HitlService();
