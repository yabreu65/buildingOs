import { AssistantTextResponse } from './AssistantTextResponse';
import { AssistantTableResponse } from './AssistantTableResponse';
import { AssistantKpiResponse } from './AssistantKpiResponse';
import { AssistantClarificationResponse } from './AssistantClarificationResponse';
import { AssistantActionListResponse } from './AssistantActionListResponse';

/**
 * Structured response from the NLU engine (v2)
 */
export interface StructuredResponse {
  type: 'text' | 'table' | 'kpi' | 'chart' | 'clarification' | 'action_list';
  title: string;
  summary: string;
  data?: unknown;
  actions?: Array<{
    label: string;
    action: string;
    payload?: object;
  }>;
}

interface Props {
  response: StructuredResponse;
  onClarificationSelect?: (value: string) => void;
  onAction?: (action: string, payload?: object) => void;
}

/**
 * AssistantResponseRenderer - Dispatcher component that renders the appropriate response type
 *
 * Routes to the correct renderer based on response type.
 *
 * @param response - The structured response to render
 * @param onClarificationSelect - Callback for clarification responses
 * @param onAction - Callback for action list responses
 */
export function AssistantResponseRenderer({ response, onClarificationSelect, onAction }: Props) {
  switch (response.type) {
    case 'text':
      return <AssistantTextResponse content={response.summary} />;
    case 'table':
      return <AssistantTableResponse data={(response.data as Array<Record<string, unknown>>) || []} />;
    case 'kpi':
      return <AssistantKpiResponse title={response.title} value={response.summary} />;
    case 'clarification':
      return (
        <AssistantClarificationResponse
          message={response.summary}
          options={(response.data as Array<{ label: string; value: string }>) || []}
          onSelect={onClarificationSelect || (() => {})}
        />
      );
    case 'action_list':
      return (
        <AssistantActionListResponse
          actions={response.actions || []}
          onAction={onAction || (() => {})}
        />
      );
    default:
      return <AssistantTextResponse content={response.summary} />;
  }
}
