interface Props {
  data: Array<Record<string, unknown>>;
  columns?: string[];
}

/**
 * AssistantTableResponse - Renders tabular data as a styled HTML table
 *
 * @param data - Array of objects to display in rows
 * @param columns - Optional column keys to display (defaults to all keys from first row)
 */
export function AssistantTableResponse({ data, columns }: Props) {
  const cols = columns || (data[0] ? Object.keys(data[0]) : []);

  if (data.length === 0) {
    return <p className="text-sm text-gray-500">No data available</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            {cols.map((col) => (
              <th key={col} className="px-2 py-1 text-left font-medium text-gray-600 dark:text-gray-400">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
              {cols.map((col) => (
                <td key={col} className="px-2 py-1 text-gray-900 dark:text-gray-100">
                  {String(row[col] ?? '-')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
