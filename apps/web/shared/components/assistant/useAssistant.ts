'use client';

import { useState, useCallback } from 'react';

export type AssistantAction = {
  key: string;
  label: string;
  description: string;
};

export type AssistantMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  llmUsed?: boolean;
  sources?: Array<{
    type: string;
    fileName: string;
  }>;
  actions?: AssistantAction[];
};

export type AssistantContext = {
  appId: string;
  tenantId: string;
  userId: string;
  role: string;
  route: string;
  currentModule?: string;
  permissions?: string[];
  unitOccupantRole?: 'OWNER' | 'RESIDENT';
};

export type AssistantRequest = {
  message: string;
  context: AssistantContext;
  useLlm?: boolean;
};

export type AssistantResponse = {
  message: string;
  answer: string;
  context: {
    appId: string;
    tenantId: string;
    userId: string;
    role: string;
    route: string;
    currentModule?: string;
    permissions?: string[];
  };
  actions: Array<{
    key: string;
    label: string;
    description: string;
  }>;
  llmUsed?: boolean;
  knowledgeUsed?: {
    module?: string;
    found: boolean;
    sources: Array<{
      type: string;
      fileName: string;
      trace?: {
        rankingVersion: string;
        strategyId: string;
        moduleScore: number;
        keywordScore: number;
        tagScore: number;
        occupantScore: number;
        totalScore: number;
        matchedModule: boolean;
        matchedOccupantScope: boolean;
        matchedTags: string[];
        matchedKeywords: string[];
      };
    }>;
  };
};

const ASSISTANT_API_URL = process.env.NEXT_PUBLIC_ASSISTANT_API_URL || 'http://localhost:4001';

interface UseAssistantOptions {
  initialContext?: AssistantContext;
  defaultUseLlm?: boolean;
}

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