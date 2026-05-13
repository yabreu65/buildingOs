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

function normalizeClarificationOptions(data: unknown): Array<{ label: string; value: string }> {
  if (Array.isArray(data)) {
    return data
      .filter((item): item is { label: string; value: string } => {
        return Boolean(item && typeof item === 'object' && 'label' in item && 'value' in item);
      });
  }

  if (data && typeof data === 'object') {
    const record = data as { alternatives?: unknown };
    if (Array.isArray(record.alternatives)) {
      return record.alternatives.map((item: any, idx) => ({
        label: item?.displayName || item?.name || item?.reason || `Opción ${idx + 1}`,
        value: item?.id || item?.value || String(idx),
      }));
    }
  }

  return [];
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
          options={normalizeClarificationOptions(response.data)}
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
