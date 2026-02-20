import { apiClient } from '@/shared/lib/http/client';

export type AiNudgeSeverity = 'INFO' | 'WARN' | 'BLOCK';

export interface AiNudgeCta {
  label: string;
  action: string;
  href?: string;
}

export interface AiNudge {
  key:
    | 'NUDGE_80'
    | 'NUDGE_100'
    | 'NUDGE_REPEAT'
    | 'NUDGE_BIG_USAGE'
    | 'NUDGE_TEMPLATE_VALUE';
  severity: AiNudgeSeverity;
  title: string;
  message: string;
  dismissible: boolean;
  ctas: AiNudgeCta[];
}

export interface RecommendedUpgradeResponse {
  requestId: string;
  requestedPlanId: string;
  note: string;
  alreadyPending: boolean;
}

export async function fetchAiNudges(tenantId: string): Promise<AiNudge[]> {
  return apiClient<AiNudge[]>({
    path: '/me/ai/nudges',
    method: 'GET',
    headers: {
      'X-Tenant-Id': tenantId,
    },
  });
}

export async function dismissAiNudge(
  tenantId: string,
  key: AiNudge['key'],
): Promise<{ key: AiNudge['key']; dismissedUntil: string }> {
  return apiClient<{ key: AiNudge['key']; dismissedUntil: string }>({
    path: `/me/ai/nudges/${key}/dismiss`,
    method: 'POST',
    headers: {
      'X-Tenant-Id': tenantId,
    },
  });
}

export async function requestRecommendedUpgrade(
  tenantId: string,
): Promise<RecommendedUpgradeResponse> {
  return apiClient<RecommendedUpgradeResponse, { tenantId: string }>({
    path: '/me/ai/upgrade-request/recommended',
    method: 'POST',
    headers: {
      'X-Tenant-Id': tenantId,
    },
    body: {
      tenantId,
    },
  });
}
