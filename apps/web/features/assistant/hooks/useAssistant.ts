/**
 * useAssistant Hook
 *
 * Manages AI Assistant chat state and interactions
 */

import { useState, useCallback } from 'react';
import {
  assistantApi,
  ChatRequest,
  ChatResponse,
  SuggestedAction,
} from '../services/assistant.api';

export interface UseAssistantState {
  loading: boolean;
  error: string | null;
  answer: string | null;
  suggestedActions: SuggestedAction[];
}

export interface UseAssistantActions {
  sendMessage: (message: string, context: Omit<ChatRequest, 'message'>) => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

export function useAssistant(
  tenantId: string,
): UseAssistantState & UseAssistantActions {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [suggestedActions, setSuggestedActions] = useState<SuggestedAction[]>([]);

  const sendMessage = useCallback(
    async (message: string, context: Omit<ChatRequest, 'message'>) => {
      if (!message.trim()) {
        setError('Message cannot be empty');
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response: ChatResponse = await assistantApi.chat(tenantId, {
          ...context,
          message,
        });

        setAnswer(response.answer);
        setSuggestedActions(response.suggestedActions || []);
      } catch (err: any) {
        if (err.code === 'AI_RATE_LIMITED') {
          setError('Daily AI limit reached. Please try again tomorrow.');
        } else if (err.code === 'FEATURE_NOT_AVAILABLE') {
          setError('AI Assistant not available on your plan. Please upgrade.');
        } else {
          setError(err.message || 'Failed to get AI response. Please try again.');
        }
        setAnswer(null);
        setSuggestedActions([]);
      } finally {
        setLoading(false);
      }
    },
    [tenantId],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setAnswer(null);
    setSuggestedActions([]);
  }, []);

  return {
    loading,
    error,
    answer,
    suggestedActions,
    sendMessage,
    clearError,
    reset,
  };
}
