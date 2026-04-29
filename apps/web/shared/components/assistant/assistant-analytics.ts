/**
 * Assistant Analytics
 * 
 * Instrumentación de eventos para el assistant.
 * Currently logs to console (debug), but structured for easy swap to real analytics.
 */
import { apiClient } from '@/shared/lib/http/client';


const STORAGE_KEY = 'assistant_session_id';

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

export function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') {
    return `session-ssr-${Date.now()}`;
  }

  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      return stored;
    }

    const newSessionId = crypto.randomUUID();
    sessionStorage.setItem(STORAGE_KEY, newSessionId);
    return newSessionId;
  } catch {
    return crypto.randomUUID();
  }
}

export function getSessionId(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    return sessionStorage.getItem(STORAGE_KEY);
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
        headers: {
          'X-Tenant-Id': event.tenantId,
        },
      });
    } catch (error) {
      console.warn('[AssistantAnalytics] Error sending to backend:', error);
    }
  }
}
