'use client';

/**
 * AI Top Items List
 * Generic component for displaying templates, actions, pages, etc.
 * Shows items with relative bar widths
 */

interface TopItem {
  label: string;
  count: number;
}

interface AiTopListProps {
  title: string;
  items: TopItem[];
  showBars?: boolean;
}

export function AiTopList({
  title,
  items,
  showBars = true,
}: AiTopListProps) {
  if (!items || items.length === 0) {
    return (
      <div className="py-6 text-center text-gray-500">
        No data available
      </div>
    );
  }

  const maxCount = Math.max(...items.map((item) => item.count), 1);

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-4">{title}</h3>
      <div className="space-y-3">
        {items.map((item) => {
          const percentage = (item.count / maxCount) * 100;
          const label = formatLabel(item.label);

          return (
            <div key={item.label}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-700">{label}</span>
                <span className="text-xs font-medium text-gray-600">
                  {item.count}
                </span>
              </div>
              {showBars && (
                <div className="w-full bg-gray-200 rounded h-2">
                  <div
                    className="bg-blue-500 h-2 rounded transition-all"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Format label: convert SNAKE_CASE or camelCase to Title Case
 */
function formatLabel(label: string): string {
  return label
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
