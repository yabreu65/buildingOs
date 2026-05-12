interface Action {
  label: string;
  action: string;
  payload?: object;
}

interface Props {
  actions: Action[];
  onAction: (action: string, payload?: object) => void;
}

/**
 * AssistantActionListResponse - Renders a list of action buttons
 *
 * @param actions - Array of actions to display as buttons
 * @param onAction - Callback when user clicks an action button
 */
export function AssistantActionListResponse({ actions, onAction }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((act, i) => (
        <button
          key={i}
          onClick={() => onAction(act.action, act.payload)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          {act.label}
        </button>
      ))}
    </div>
  );
}
