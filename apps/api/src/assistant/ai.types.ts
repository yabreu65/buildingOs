/**
 * Shared AI Provider Types
 */

export type SuggestedActionType =
  | 'VIEW_TICKETS'
  | 'VIEW_PAYMENTS'
  | 'VIEW_REPORTS'
  | 'VIEW_DOCUMENTS'
  | 'SEARCH_DOCS'
  | 'DRAFT_COMMUNICATION'
  | 'CREATE_TICKET';

export interface SuggestedAction {
  type: SuggestedActionType;
  payload: Record<string, string | undefined>;
}

export interface AiProviderChatOptions {
  model?: string;
  maxTokens?: number;
}

export type AssistantConsensusIntent = 'tenant_debt' | 'building_debt' | 'unit_debt' | 'unknown';

export type AssistantConsensusScope = 'tenant' | 'building' | 'unit' | 'unknown';

export type AssistantConsensusPeriodKind =
  | 'current_month'
  | 'previous_month'
  | 'named_month'
  | 'relative_month'
  | 'relative_range'
  | 'month_range'
  | 'year_to_date'
  | 'accumulated'
  | 'unknown';

export interface AssistantConsensusEntity {
  buildingAlias: string | null;
  unitAlias: string | null;
}

export interface AssistantConsensusPeriod {
  kind: AssistantConsensusPeriodKind;
  month: number | null;
  year: number | null;
  offset: number | null;
  amount: number | null;
  unit: 'month' | null;
  mode: 'including_current' | 'closed_months' | 'unknown' | null;
}

export interface AssistantConsensusModelPlan {
  intent: AssistantConsensusIntent;
  scope: AssistantConsensusScope;
  entity: AssistantConsensusEntity;
  period: AssistantConsensusPeriod;
  confidence: number;
  requiresClarification: boolean;
  missingFields: string[];
}

export interface AssistantConsensusResult {
  consensus: boolean;
  deterministicIntent: AssistantConsensusIntent;
  modelIntent: AssistantConsensusIntent;
  mismatchReason?: string;
  clarificationMessage?: string;
}

export interface AssistantConsensusModeConfig {
  provider: 'none' | 'hybrid' | 'openai' | 'opencode' | 'ollama' | 'gemini';
  localProvider: 'ollama';
  alwaysCallLocalModel: boolean;
  consensusMode: boolean;
  geminiFallbackEnabled: boolean;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
}

export interface AssistantConsensusEvaluation {
  consensus: boolean;
  deterministicPlan: AssistantConsensusModelPlan | null;
  modelPlan: AssistantConsensusModelPlan | null;
  mismatchReason?: string;
  modelValid?: boolean;
  modelInvalidReason?: 'model_semantic_invalid' | 'model_intent_scope_conflict';
  clarificationMessage?: string;
  usedLocalModel: boolean;
  localProvider: 'ollama';
  localBaseUrl: string;
  localModel: string;
}

export interface ChatResponse {
  answer: string;
  suggestedActions: SuggestedAction[];
  interactionId?: string;
}

export interface AiProviderContext {
  tenantId?: string;
  buildingId?: string;
  unitId?: string;
  ticketId?: string;
  page?: string;
  contextSnapshot?: Record<string, unknown>;
}

export interface AiProvider {
  /**
   * Generate a chat response for the given message and context.
   */
  chat(
    message: string,
    context: AiProviderContext,
    options?: AiProviderChatOptions,
  ): Promise<ChatResponse>;

  /**
   * Check if the AI provider is reachable and responsive.
   * Returns status: healthy (reachable), degraded (slow/partial), unavailable (down), or disabled (not configured).
   */
  healthCheck(): Promise<AiProviderStatus>;
}

/**
 * Health check status for AI providers
 */
export interface AiProviderStatus {
  status: 'healthy' | 'degraded' | 'unavailable' | 'disabled';
  provider: string;
  latencyMs?: number;
  error?: string;
  modelsAvailable?: string[];
}

export interface ClassifierResult {
  category: 'DEBT' | 'TICKETS' | 'DOCUMENTS' | 'PAYMENTS' | 'RESIDENTS' | 'STATS' | 'GENERAL';
  confidence: number;
}

/**
 * Structured response from the NLU engine (v2 endpoint)
 */
export interface StructuredResponse {
  /** Response type */
  type: 'text' | 'table' | 'kpi' | 'chart' | 'clarification' | 'action_list';
  /** Response title */
  title: string;
  /** Human-readable summary */
  summary: string;
  /** Response data (format depends on type) */
  data?: unknown;
  /** Suggested actions */
  actions?: StructuredResponseAction[];
  /** Metadata */
  meta?: StructuredResponseMeta;
  /**
   * Optional diagnostics for /chat/v2 debug mode.
   */
  debug?: StructuredResponseDebug;
}

export interface StructuredResponseAction {
  /** Action type identifier */
  action: string;
  /** Human-readable label */
  label: string;
  /** Action payload */
  payload?: Record<string, unknown>;
}

export interface StructuredResponseMeta {
  /** Intent that produced this response */
  intent?: string;
  /** Confidence score from extraction */
  confidence?: number;
  /** Additional metadata */
  [key: string]: unknown;
}

export interface StructuredResponseDebug {
  usedDeterministic?: boolean;
  deterministicIntent?: string | null;
  deterministicConfidence?: number | null;
  coverageStatus?: 'complete' | 'incomplete' | 'failed';
  coverageMissing?: string[];
  usedLLM?: boolean;
  llmProvider?: 'ollama' | 'opencode' | 'gemini' | 'none' | 'unknown';
  llmBaseUrl?: string;
  llmModel?: string;
  llmReason?: 'no_intent' | 'missing_filters' | 'low_confidence' | 'multi_intent' | 'pending_clarification' | 'consensus_mismatch' | 'local_model_failed' | 'none';
  consensusMode?: boolean;
  consensusResult?: 'matched' | 'mismatch' | 'failed';
  consensusReason?: string;
  semanticValidationStatus?: 'accepted' | 'needs_clarification' | 'override_suggested';
  semanticValidationReason?: string;
  zodValidationPassed?: boolean;
  finalIntent?: string;
  finalFilters?: Record<string, unknown>;
  rbacChecked?: boolean;
  tenantScoped?: boolean;
}
