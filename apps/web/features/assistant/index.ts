// Components
export { AssistantWidget } from './components/AssistantWidget';
export { SuggestedActionsList } from './components/SuggestedActionsList';

// Hooks
export { useAssistant, type UseAssistantState, type UseAssistantActions } from './hooks/useAssistant';

// API Service
export { assistantApi, type ChatRequest, type ChatResponse, type SuggestedAction } from './services/assistant.api';

// AI Actions Bridge
export {
  handleSuggestedAction,
  getActionLabel,
  isActionAllowed,
  type ActionContext,
  type ActionResult,
} from './handlers/aiActions';
