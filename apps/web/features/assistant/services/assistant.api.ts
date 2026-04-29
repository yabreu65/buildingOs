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
  buildingId?: string;
  unitId?: string;
}

export interface ActionDefinition {
  key: string;
  label: string;
  description?: string;
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
      const response = await apiClient<{
        answer: string;
        actions?: ActionDefinition[];
        suggestedActions?: SuggestedAction[];
      }, ChatRequest>({
        path: `/tenants/${tenantId}/assistant/chat`,
        method: 'POST',
        body: request,
        headers: {
          'X-Tenant-Id': tenantId,
        },
      });

      // Map backend actions to frontend suggestedActions format
      const suggestedActions: SuggestedAction[] =
        response.suggestedActions ??
        (response.actions || []).map((action) => {
          return {
            type: this.mapActionKeyToType(action.key),
            payload: { actionKey: action.key },
          };
        });

      return {
        answer: response.answer,
        suggestedActions,
      };
    } catch (error) {
      const httpError = error as HttpError;

      // Special handling for rate limit
      if (httpError.status === 429) {
        throw {
          code: 'AI_RATE_LIMITED',
          message: httpError.message || 'Daily AI limit exceeded',
          status: 429,
        };
      }

      // Feature not available
      if (httpError.status === 403) {
        throw {
          code: 'FEATURE_NOT_AVAILABLE',
          message: httpError.message || 'AI Assistant not available on your plan',
          status: 403,
        };
      }

      throw {
        code: 'AI_ERROR',
        message: httpError.message || 'Failed to get AI response',
        status: httpError.status,
      };
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
}

// Singleton instance
export const assistantApi = new AssistantApi();
