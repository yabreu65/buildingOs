/**
 * Assistant API Service
 *
 * Handles communication with the AI Assistant backend endpoint.
 * All requests include X-Tenant-Id header for multi-tenant isolation.
 */

import { apiClient, HttpError } from '@/shared/lib/http/client';

export interface SuggestedAction {
  type:
    | 'VIEW_TICKETS'
    | 'VIEW_PAYMENTS'
    | 'VIEW_REPORTS'
    | 'SEARCH_DOCS'
    | 'DRAFT_COMMUNICATION'
    | 'CREATE_TICKET';
  payload: Record<string, unknown>;
}

export interface ChatResponse {
  answer: string;
  actions?: ActionDefinition[];
  suggestedActions: SuggestedAction[];
}

export interface ChatRequest {
  message: string;
  page: string;
   currentPage?: string;
  buildingId?: string;
  unitId?: string;
   financePeriod?: string;
  conversationId?: string;
}

/**
 * Structured response from the NLU engine (v2 endpoint)
 */
export interface StructuredResponse {
  type: 'text' | 'table' | 'kpi' | 'chart' | 'clarification' | 'action_list';
  title: string;
  summary: string;
  data?: unknown;
  actions?: Array<{
    label: string;
    action: string;
    payload?: object;
  }>;
  meta: {
    intent: string;
    confidence: number;
    tenantScoped: true;
  };
}

export interface ActionDefinition {
  key: string;
  label: string;
  description?: string;
}


export class AssistantApiError extends Error {
  readonly code: 'AI_RATE_LIMITED' | 'FEATURE_NOT_AVAILABLE' | 'AI_ERROR';
  readonly status?: number;

  constructor(code: AssistantApiError['code'], message: string, status?: number) {
    super(message);
    this.name = 'AssistantApiError';
    this.code = code;
    this.status = status;
  }
}

export class AssistantApi {
  /**
   * Send chat message to AI assistant
   *
   * @param tenantId - Tenant ID
   * @param request - Chat request with message, page, context
   * @returns ChatResponse with answer and suggestedActions
   * @throws Error if feature not available, rate limited, or request fails
   */
  async chat(tenantId: string, request: ChatRequest): Promise<ChatResponse> {
    try {
      // Legacy frontend consumer now uses the official v2 endpoint while
      // preserving the legacy ChatResponse contract.
      const response = await apiClient<StructuredResponse, ChatRequest>({
        path: `/tenants/${tenantId}/assistant/chat/v2`,
        method: 'POST',
        body: request,
        headers: {
          'X-Tenant-Id': tenantId,
        },
      });

      // Map structured actions to legacy suggestedActions format
      const suggestedActions: SuggestedAction[] = (response.actions || []).map((action) => {
        return {
          type: this.mapActionKeyToType(action.action),
          payload: { actionKey: action.action },
        };
      });

      return {
        answer: response.summary,
        suggestedActions,
      };
    } catch (error) {
      const httpError = error as HttpError;

      // Special handling for rate limit
      if (httpError.status === 429) {
        throw new AssistantApiError(
          'AI_RATE_LIMITED',
          httpError.message || 'Daily AI limit exceeded',
          429,
        );
      }

      // Feature not available
      if (httpError.status === 403) {
        throw new AssistantApiError(
          'FEATURE_NOT_AVAILABLE',
          httpError.message || 'AI Assistant not available on your plan',
          403,
        );
      }

      throw new AssistantApiError(
        'AI_ERROR',
        httpError.message || 'Failed to get AI response',
        httpError.status,
      );
    }
  }

  private mapActionKeyToType(actionKey: string): SuggestedAction['type'] {
    const mapping: Record<string, SuggestedAction['type']> = {
      // Tickets
      'open-tickets': 'VIEW_TICKETS',
      'view-my-tickets': 'VIEW_TICKETS',
      'review-open-tickets': 'VIEW_TICKETS',
      'view-all-tickets': 'VIEW_TICKETS',
      'create-ticket': 'CREATE_TICKET',
      // Payments
      'open-payments': 'VIEW_PAYMENTS',
      'open-payments-review': 'VIEW_PAYMENTS',
      'view-payment-history': 'VIEW_PAYMENTS',
      'view-all-payments': 'VIEW_PAYMENTS',
      'view-my-balance': 'VIEW_PAYMENTS',
      'view-pending-charges': 'VIEW_PAYMENTS',
      'report-payment': 'VIEW_PAYMENTS',
      'upload-payment-proof': 'VIEW_PAYMENTS',
      // Charges
      'open-charges': 'VIEW_REPORTS',
      'review-pending-payments': 'VIEW_REPORTS',
      // Communications
      'open-communications': 'DRAFT_COMMUNICATION',
      'create-communication': 'DRAFT_COMMUNICATION',
      'view-all-communications': 'DRAFT_COMMUNICATION',
      'view-my-inbox': 'DRAFT_COMMUNICATION',
      'view-notices': 'DRAFT_COMMUNICATION',
      // Documents
      'open-documents': 'SEARCH_DOCS',
      'upload-document': 'SEARCH_DOCS',
      'view-building-documents': 'SEARCH_DOCS',
      'view-rules': 'SEARCH_DOCS',
    };
    return mapping[actionKey] || 'VIEW_REPORTS';
  }

  /**
   * Send chat message to AI assistant (v2 - structured responses)
   *
   * @param tenantId - Tenant ID
   * @param request - Chat request with message, page, context, and conversationId
   * @returns StructuredResponse with typed response
   * @throws Error if feature not available, rate limited, or request fails
   */
  async chatV2(tenantId: string, request: ChatRequest): Promise<StructuredResponse> {
    try {
      const response = await apiClient<StructuredResponse, ChatRequest>({
        path: `/tenants/${tenantId}/assistant/chat/v2`,
        method: 'POST',
        body: request,
        headers: {
          'X-Tenant-Id': tenantId,
        },
      });

      return response;
    } catch (error) {
      const httpError = error as HttpError;

      // Special handling for rate limit
      if (httpError.status === 429) {
        throw new AssistantApiError(
          'AI_RATE_LIMITED',
          httpError.message || 'Daily AI limit exceeded',
          429,
        );
      }

      // Feature not available
      if (httpError.status === 403) {
        throw new AssistantApiError(
          'FEATURE_NOT_AVAILABLE',
          httpError.message || 'AI Assistant not available on your plan',
          403,
        );
      }

      throw new AssistantApiError(
        'AI_ERROR',
        httpError.message || 'Failed to get AI response',
        httpError.status,
      );
    }
  }
}

// Singleton instance
export const assistantApi = new AssistantApi();
