interface Option {
  label: string;
  value: string;
}

interface Props {
  message: string;
  options: Option[];
  onSelect: (value: string) => void;
}

/**
 * AssistantClarificationResponse - Renders a clarification prompt with selectable options
 *
 * @param message - The clarification question to display
 * @param options - Array of options the user can select
 * @param onSelect - Callback when user selects an option
 */
export function AssistantClarificationResponse({ message, options, onSelect }: Props) {
  return (
    <div className="space-y-2">
      <p className="text-sm">{message}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onSelect(opt.value)}
            className="px-3 py-1 text-sm bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded-full hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
