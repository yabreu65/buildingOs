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
  suggestedActions: SuggestedAction[];
}

export interface ChatRequest {
  message: string;
  page: string;
  buildingId?: string;
  unitId?: string;
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
      return await apiClient<ChatResponse, ChatRequest>({
        path: `/tenants/${tenantId}/assistant/${tenantId}/chat`,
        method: 'POST',
        body: request,
        headers: {
          'X-Tenant-Id': tenantId,
        },
      });
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
}

// Singleton instance
export const assistantApi = new AssistantApi();
