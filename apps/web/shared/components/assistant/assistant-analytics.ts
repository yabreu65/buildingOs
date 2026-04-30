/**
 * Assistant Analytics
 * 
 * Instrumentación de eventos para el assistant.
 * Currently logs to console (debug), but structured for easy swap to real analytics.
 */
import { apiClient } from '@/shared/lib/http/client';


const STORAGE_KEY = 'assistant_session_id';

function resolveStorageKey(scopeKey?: string): string {
  const normalizedScope = scopeKey?.trim();
  return normalizedScope ? `${STORAGE_KEY}:${normalizedScope}` : STORAGE_KEY;
}

export type AssistantActionClickEvent = {
  eventName: 'assistant_action_click';
  actionKey: string;
  actionLabel: string;
  tenantId: string;
  currentRoute: string;
  currentModule?: string;
  targetPath: string | null;
  isMapped: boolean;
  sessionId: string;
  messageId: string;
  actionIndex: number;
  totalActions: number;
  timestamp: string;
};

export type AssistantAnalyticsConfig = {
  debug?: boolean;
  sendToBackend?: boolean;
  backendUrl?: string;
};

let analyticsConfig: AssistantAnalyticsConfig = {
  debug: process.env.NODE_ENV !== 'production',
  sendToBackend: true,
};

export function configureAssistantAnalytics(config: Partial<AssistantAnalyticsConfig>): void {
  analyticsConfig = { ...analyticsConfig, ...config };
}

export function getOrCreateSessionId(scopeKey?: string): string {
  if (typeof window === 'undefined') {
    return `session-ssr-${Date.now()}`;
  }

  const storageKey = resolveStorageKey(scopeKey);

  try {
    const stored = sessionStorage.getItem(storageKey);
    if (stored) {
      return stored;
    }

    const newSessionId = crypto.randomUUID();
    sessionStorage.setItem(storageKey, newSessionId);
    return newSessionId;
  } catch {
    return crypto.randomUUID();
  }
}

export function getSessionId(scopeKey?: string): string | null {
  if (typeof window === 'undefined') return null;

  const storageKey = resolveStorageKey(scopeKey);

  try {
    return sessionStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

export function createActionClickEvent(params: {
  actionKey: string;
  actionLabel: string;
  tenantId: string;
  currentRoute: string;
  currentModule?: string;
  targetPath: string | null;
  isMapped: boolean;
  sessionId: string;
  messageId: string;
  actionIndex: number;
  totalActions: number;
}): AssistantActionClickEvent {
  return {
    eventName: 'assistant_action_click',
    actionKey: params.actionKey,
    actionLabel: params.actionLabel,
    tenantId: params.tenantId,
    currentRoute: params.currentRoute,
    currentModule: params.currentModule,
    targetPath: params.targetPath,
    isMapped: params.isMapped,
    sessionId: params.sessionId,
    messageId: params.messageId,
    actionIndex: params.actionIndex,
    totalActions: params.totalActions,
    timestamp: new Date().toISOString(),
  };
}

export async function trackAssistantActionClick(
  event: AssistantActionClickEvent
): Promise<void> {
  if (analyticsConfig.debug) {
    console.debug('[AssistantAnalytics]', event);
  }

  if (analyticsConfig.sendToBackend) {
    try {
      await apiClient<unknown, {
        actionType: string;
        source: string;
        page: string;
        interactionId: string;
      }>({
        path: `/tenants/${event.tenantId}/assistant/action-events`,
        method: 'POST',
        body: {
          actionType: event.actionKey,
          source: 'CHAT',
          page: event.currentRoute,
          interactionId: event.messageId,
        },
      });
    } catch (error) {
      console.warn('[AssistantAnalytics] Error sending to backend:', error);
    }
  }
}
