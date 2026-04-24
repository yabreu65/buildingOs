export type AssistantToolName =
  | 'resolve_unit_ref'
  | 'get_unit_balance'
  | 'get_unit_profile'
  | 'get_unit_payments'
  | 'get_unit_balance_by_period'
  | 'search_payments'
  | 'analytics_debt_aging'
  | 'analytics_debt_by_tower'
  | 'search_tickets';

export interface AssistantToolContext {
  appId?: string;
  tenantId: string;
  userId: string;
  role: string;
}

export interface AssistantToolRequest {
  intentCode?: string;
  question?: string;
  contractVersion?: string;
  responseContractVersion?: string;
  toolInput?: Record<string, unknown>;
  context: AssistantToolContext;
}

export type AssistantToolAction = {
  key: string;
  label: string;
  description?: string;
  requiresConfirmation?: boolean;
  destructive?: boolean;
  requiredPermission?: string;
};

export interface AssistantToolResponse {
  contractVersion: string;
  answer: string;
  answerSource: 'live_data' | 'fallback';
  responseType: 'metric' | 'list' | 'summary' | 'no_data' | 'clarification';
  dataScope: 'tenant' | 'self' | 'module' | 'unknown';
  actions: AssistantToolAction[];
  metadata: Record<string, unknown>;
}

export const ASSISTANT_TOOLS_ALLOWLIST: AssistantToolName[] = [
  'resolve_unit_ref',
  'get_unit_balance',
  'get_unit_profile',
  'get_unit_payments',
  'get_unit_balance_by_period',
  'search_payments',
  'analytics_debt_aging',
  'analytics_debt_by_tower',
  'search_tickets',
];

export const ASSISTANT_RESPONSE_SCHEMA_VERSION = '2026-04-p0-response-v1';

export const ASSISTANT_TOOL_REQUEST_CONTRACT_VERSION = '2026-04-readonly-v1';
