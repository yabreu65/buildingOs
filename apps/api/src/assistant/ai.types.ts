/**
 * Shared AI Provider Types
 */

export type SuggestedActionType =
  | 'VIEW_TICKETS'
  | 'VIEW_PAYMENTS'
  | 'VIEW_REPORTS'
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
