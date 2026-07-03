'use client';

import { useState, useCallback } from 'react';
import { getPublicApiUrl } from '../../lib/public-api-url';

export interface AssistantAction {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
}

export interface StructuredResponse {
  readonly type: 'text' | 'table' | 'kpi' | 'chart' | 'clarification' | 'action_list';
  readonly title: string;
  readonly summary: string;
  readonly data?: unknown;
  readonly actions?: Array<{
    readonly label: string;
    readonly action: string;
    readonly payload?: object;
  }>;
  readonly meta: {
    readonly intent: string;
    readonly confidence: number;
    readonly tenantScoped: true;
  };
}

export interface AssistantSourceTrace {
  readonly rankingVersion: string;
  readonly strategyId: string;
  readonly moduleScore: number;
  readonly keywordScore: number;
  readonly tagScore: number;
  readonly occupantScore: number;
  readonly totalScore: number;
  readonly matchedModule: boolean;
  readonly matchedOccupantScope: boolean;
  readonly matchedTags: readonly string[];
  readonly matchedKeywords: readonly string[];
}

export interface AssistantSource {
  readonly type: string;
  readonly fileName: string;
  readonly trace?: AssistantSourceTrace;
}

export interface AssistantMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly llmUsed?: boolean;
  readonly sources?: readonly AssistantSource[];
  readonly actions?: readonly AssistantAction[];
  readonly structuredResponse?: StructuredResponse;
}

export interface AssistantContext {
  readonly appId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly role: string;
  readonly route: string;
  readonly page?: string;
  readonly currentPage?: string;
  readonly buildingId?: string;
  readonly unitId?: string;
  readonly financePeriod?: string;
  readonly currentModule?: string;
  readonly permissions?: readonly string[];
  readonly unitOccupantRole?: 'OWNER' | 'RESIDENT';
}

export interface AssistantRequest {
  readonly message: string;
  readonly context: AssistantContext;
  readonly useLlm?: boolean;
}

export interface AssistantResponseContext {
  readonly appId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly role: string;
  readonly route: string;
  readonly currentModule?: string;
  readonly permissions?: readonly string[];
}

export interface AssistantKnowledgeUsed {
  readonly module?: string;
  readonly found: boolean;
  readonly sources: readonly AssistantSource[];
}

export interface AssistantResponse {
  readonly message: string;
  readonly answer: string;
  readonly context: AssistantResponseContext;
  readonly actions: readonly AssistantAction[];
  readonly llmUsed?: boolean;
  readonly knowledgeUsed?: AssistantKnowledgeUsed;
}

const ASSISTANT_API_URL = getPublicApiUrl();

interface UseAssistantOptions {
  initialContext?: AssistantContext;
  defaultUseLlm?: boolean;
}

/**
 * Manage assistant chat state and message dispatch for legacy widget consumers.
 *
 * @param options - Initial assistant context and default LLM behavior.
 * @returns State and actions for rendering an assistant chat surface.
 */
export function useAssistant(options: UseAssistantOptions = {}) {
  const { initialContext, defaultUseLlm = false } = options;
  
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<AssistantContext | undefined>(initialContext);

  const sendMessage = useCallback(async (content: string) => {
    if (!context) {
      setError('Context not initialized');
      return;
    }

    const userMessage: AssistantMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);

    try {
      const request: AssistantRequest = {
        message: content,
        context,
        useLlm: defaultUseLlm,
      };

      const response = await fetch(`${ASSISTANT_API_URL}/assistant/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Error: ${response.status} ${response.statusText}`);
      }

      const data: AssistantResponse = await response.json();

      const assistantMessage: AssistantMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.answer,
        llmUsed: data.llmUsed,
        sources: data.knowledgeUsed?.sources,
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      
      const errorMsg: AssistantMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${errorMessage}`,
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [context, defaultUseLlm]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const updateContext = useCallback((newContext: Partial<AssistantContext>) => {
    setContext(prev => prev ? { ...prev, ...newContext } : undefined);
  }, []);

  return {
    messages,
    isLoading,
    error,
    context,
    sendMessage,
    clearMessages,
    updateContext,
  };
}
