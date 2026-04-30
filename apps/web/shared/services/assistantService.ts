import { apiClient } from '@/shared/lib/http/client';

export type BuildingOsSuggestedActionType =
  | 'VIEW_TICKETS'
  | 'VIEW_PAYMENTS'
  | 'VIEW_REPORTS'
  | 'SEARCH_DOCS'
  | 'DRAFT_COMMUNICATION'
  | 'CREATE_TICKET';

export interface BuildingOsSuggestedAction {
  type: BuildingOsSuggestedActionType;
  payload?: Record<string, unknown>;
}

export interface AssistantServiceRequest {
  tenantId: string;
  message: string;
  page: string;
  buildingId?: string;
  unitId?: string;
  route?: string;
  sessionId?: string;
  choiceId?: string;
}

export interface AssistantServiceResponse {
  answer: string;
  suggestedActions?: BuildingOsSuggestedAction[];
  interactionId?: string;
  responseType?: 'answer' | 'clarification' | 'error' | 'no_data';
  options?: Array<{ id: string; label: string; index: number }>;
}

type BuildingOsChatRequest = {
  message: string;
  page: string;
  buildingId?: string;
  unitId?: string;
  context?: {
    extra?: {
      sessionId?: string;
      uiPage?: string;
      choiceId?: string;
    };
  };
};

class AssistantService {
  async ask(input: AssistantServiceRequest): Promise<AssistantServiceResponse> {
    const requestBody: BuildingOsChatRequest = {
      message: input.message,
      page: input.page,
      buildingId: input.buildingId,
      unitId: input.unitId,
      context: {
        extra: {
          sessionId: input.sessionId,
          uiPage: input.route,
          ...(input.choiceId && { choiceId: input.choiceId }),
        },
      },
    };

    return apiClient<AssistantServiceResponse, BuildingOsChatRequest>({
      path: `/tenants/${input.tenantId}/assistant/chat`,
      method: 'POST',
      body: requestBody,
    });
  }
}

export const assistantService = new AssistantService();
