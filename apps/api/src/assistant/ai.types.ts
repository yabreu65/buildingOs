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
  chat(
    message: string,
    context: AiProviderContext,
    options?: { model?: string; maxTokens?: number },
  ): Promise<ChatResponse>;
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
  actions?: Array<{
    /** Action type identifier */
    action: string;
    /** Human-readable label */
    label: string;
    /** Action payload */
    payload?: Record<string, unknown>;
  }>;
  /** Metadata */
  meta?: {
    /** Intent that produced this response */
    intent?: string;
    /** Confidence score from extraction */
    confidence?: number;
    /** Additional metadata */
    [key: string]: unknown;
  };
}
