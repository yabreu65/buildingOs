'use client';

import { useState, useCallback } from 'react';
import { HttpError } from '@/shared/lib/http/client';
import {
  assistantService,
  BuildingOsSuggestedAction,
  BuildingOsSuggestedActionType,
} from '@/shared/services/assistantService';

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
  responseType?: 'answer' | 'clarification' | 'error' | 'no_data';
  options?: Array<{ id: string; label: string; index: number }>;
};

export type AssistantContext = {
  appId: string;
  tenantId: string;
  userId: string;
  role: string;
  route: string;
  buildingId?: string;
  unitId?: string;
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

const SUGGESTED_ACTION_MAP: Record<BuildingOsSuggestedActionType, AssistantAction> = {
  VIEW_TICKETS: {
    key: 'open-tickets',
    label: 'Ver tickets',
    description: 'Abrir la gestión de tickets.',
  },
  VIEW_PAYMENTS: {
    key: 'open-payments',
    label: 'Ver pagos',
    description: 'Abrir la gestión de pagos.',
  },
  VIEW_REPORTS: {
    key: 'open-charges',
    label: 'Ver finanzas',
    description: 'Abrir el módulo financiero.',
  },
  SEARCH_DOCS: {
    key: 'open-documents',
    label: 'Ver documentos',
    description: 'Abrir la biblioteca de documentos.',
  },
  DRAFT_COMMUNICATION: {
    key: 'create-communication',
    label: 'Crear comunicación',
    description: 'Abrir el flujo de comunicación.',
  },
  CREATE_TICKET: {
    key: 'create-ticket',
    label: 'Crear ticket',
    description: 'Abrir el flujo de creación de tickets.',
  },
};

function mapSuggestedAction(action: BuildingOsSuggestedAction): AssistantAction {
  return SUGGESTED_ACTION_MAP[action.type];
}

function formatAssistantError(error: unknown): string {
  if (error instanceof HttpError) {
    return error.message || `Error del asistente AI (${error.status}).`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

interface UseAssistantOptions {
  initialContext?: AssistantContext;
}

function getSessionStorageKey(context?: AssistantContext): string {
  if (!context) {
    return 'assistant_chat_session_id:global';
  }
  return `assistant_chat_session_id:${context.tenantId}:${context.userId}`;
}

function getOrCreateScopedSessionId(context?: AssistantContext): string {
  if (typeof window === 'undefined') return `ssr-${Date.now()}`;
  const key = getSessionStorageKey(context);
  const stored = sessionStorage.getItem(key);
  if (stored) return stored;
  const newId = crypto.randomUUID();
  sessionStorage.setItem(key, newId);
  return newId;
}

export function useAssistant(options: UseAssistantOptions = {}) {
  const { initialContext } = options;
  
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<AssistantContext | undefined>(initialContext);

  const sendMessage = useCallback(async (content: string, choiceId?: string) => {
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
      const sessionId = getOrCreateScopedSessionId(context);
      const data = await assistantService.ask({
        tenantId: context.tenantId,
        message: content,
        page: context.currentModule || context.route || 'assistant',
        buildingId: context.buildingId,
        unitId: context.unitId,
        route: context.route,
        sessionId,
        choiceId,
      });

      const assistantMessage: AssistantMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.answer,
        actions: (data.suggestedActions || []).map(mapSuggestedAction),
        responseType: data.responseType,
        options: data.options,
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      const errorMessage = formatAssistantError(err);
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
  }, [context]);

  const sendClarificationChoice = useCallback((choiceId: string, label: string) => {
    return sendMessage(label, choiceId);
  }, [sendMessage]);

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
    sendClarificationChoice,
    clearMessages,
    updateContext,
  };
}
