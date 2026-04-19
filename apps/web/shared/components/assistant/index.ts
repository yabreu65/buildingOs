export { useAssistant } from './useAssistant';
export type { 
  AssistantMessage, 
  AssistantAction,
  AssistantContext, 
  AssistantRequest, 
  AssistantResponse 
} from './useAssistant';

export { AssistantWidget } from './AssistantWidget';
export type { AssistantWidgetProps } from './AssistantWidget';

export { useAssistantContext } from './useAssistantContext';

export { 
  getAssistantActionPath, 
  isAssistantActionMapped,
  getAvailableActions,
  ACTION_ROUTE_MAP 
} from './action-route-map';
export type { ActionKey, ActionPathResolver } from './action-route-map';

export {
  trackAssistantActionClick,
  createActionClickEvent,
  configureAssistantAnalytics,
  getOrCreateSessionId,
  getSessionId,
} from './assistant-analytics';
export type { 
  AssistantActionClickEvent,
  AssistantAnalyticsConfig 
} from './assistant-analytics';