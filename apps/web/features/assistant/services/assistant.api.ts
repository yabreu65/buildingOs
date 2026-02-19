/**
 * Assistant API Service
 *
 * Handles communication with the AI Assistant backend endpoint.
 * All requests include X-Tenant-Id header for multi-tenant isolation.
 */

export interface SuggestedAction {
  type:
    | 'VIEW_TICKETS'
    | 'VIEW_PAYMENTS'
    | 'VIEW_REPORTS'
    | 'SEARCH_DOCS'
    | 'DRAFT_COMMUNICATION'
    | 'CREATE_TICKET';
  payload: Record<string, any>;
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
  private baseUrl: string;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  /**
   * Send chat message to AI assistant
   *
   * @param tenantId - Tenant ID
   * @param request - Chat request with message, page, context
   * @returns ChatResponse with answer and suggestedActions
   * @throws Error if feature not available, rate limited, or request fails
   */
  async chat(tenantId: string, request: ChatRequest): Promise<ChatResponse> {
    const url = `${this.baseUrl}/tenants/${tenantId}/assistant/${tenantId}/chat`;

    const token = sessionStorage.getItem('authToken');
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': tenantId,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));

      // Special handling for rate limit
      if (response.status === 429) {
        throw {
          code: 'AI_RATE_LIMITED',
          message: error.message || 'Daily AI limit exceeded',
          status: 429,
        };
      }

      // Feature not available
      if (response.status === 403) {
        throw {
          code: 'FEATURE_NOT_AVAILABLE',
          message: error.message || 'AI Assistant not available on your plan',
          status: 403,
        };
      }

      throw {
        code: 'AI_ERROR',
        message: error.message || 'Failed to get AI response',
        status: response.status,
      };
    }

    return response.json();
  }
}

// Singleton instance
export const assistantApi = new AssistantApi();
