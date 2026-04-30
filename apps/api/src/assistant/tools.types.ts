export type AssistantToolName =
  | 'resolve_unit_ref'
  | 'get_unit_balance'
  | 'get_unit_profile'
  | 'get_unit_payments'
  | 'get_unit_balance_by_period'
  | 'search_payments'
  | 'analytics_debt_aging'
  | 'analytics_debt_by_tower'
  | 'search_tickets'
  | 'get_unit_debt_trend'
  | 'get_building_debt_trend'
  | 'get_collections_trend'
  | 'search_processes'
  | 'get_process_summary'
  | 'search_claims'
  | 'cross_query';

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
  answerSource: 'live_data' | 'fallback' | 'snapshot' | 'clarification' | 'error';
  responseType: 'metric' | 'list' | 'summary' | 'no_data' | 'clarification' | 'error';
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
  'get_unit_debt_trend',
  'get_building_debt_trend',
  'get_collections_trend',
  'search_processes',
  'get_process_summary',
  'search_claims',
  'cross_query',
];

export const ASSISTANT_RESPONSE_SCHEMA_VERSION = '2026-04-p0-response-v1';
export const ASSISTANT_RESPONSE_SCHEMA_VERSION_V2 = '2026-05-p2-response-v2';

export const ASSISTANT_TOOL_REQUEST_CONTRACT_VERSION = '2026-04-readonly-v1';
