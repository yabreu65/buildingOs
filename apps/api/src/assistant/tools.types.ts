export type AssistantToolName =
  | 'resolve_unit_ref'
  | 'get_unit_balance'
  | 'get_unit_profile'
  | 'search_payments'
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
  'search_payments',
  'search_tickets',
];

export const ASSISTANT_RESPONSE_SCHEMA_VERSION = '2026-04-p0-response-v1';
