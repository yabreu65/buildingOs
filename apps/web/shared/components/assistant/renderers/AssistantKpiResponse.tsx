interface Props {
  title: string;
  value: string | number;
  subtitle?: string;
}

/**
 * AssistantKpiResponse - Renders a KPI card with title, value, and optional subtitle
 *
 * @param title - KPI category label
 * @param value - The KPI value to display prominently
 * @param subtitle - Optional secondary description
 */
export function AssistantKpiResponse({ title, value, subtitle }: Props) {
  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 text-center">
      <h4 className="text-xs text-blue-600 dark:text-blue-400 uppercase">{title}</h4>
      <p className="text-2xl font-bold text-blue-800 dark:text-blue-200">{value}</p>
      {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
    </div>
  );
}
