/**
 * Feedback API Service
 *
 * Handles sending feedback to the analytics backend.
 */

import { apiClient } from '@/shared/lib/http/client';

export interface FeedbackRequest {
  messageId: string;
  sessionId: string;
  tenantId: string;
  role?: string;
  route?: string;
  currentModule?: string;
  rating: 'useful' | 'not_useful';
  comment?: string;
}

export class FeedbackApi {
  async submit(
    tenantId: string,
    feedback: Omit<FeedbackRequest, 'tenantId'>,
  ): Promise<{ success: true }> {
    return apiClient({
      path: `/api/analytics/feedback`,
      method: 'POST',
      body: { ...feedback, tenantId },
    });
  }
}

export const feedbackApi = new FeedbackApi();