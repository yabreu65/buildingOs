'use client';

/**
 * AI Cost vs Budget Progress Bar
 * Shows estimated cost as percentage of monthly budget
 * Color-coded: green <80%, orange >=80%, red >=100%
 */

interface AiUsageBarProps {
  estimatedCostCents: number;
  budgetCents: number;
  percentUsed: number;
  label?: string;
}

export function AiUsageBar({
  estimatedCostCents,
  budgetCents,
  percentUsed,
  label = 'Monthly Budget',
}: AiUsageBarProps) {
  const costUSD = (estimatedCostCents / 100).toFixed(2);
  const budgetUSD = (budgetCents / 100).toFixed(2);

  // Determine color based on percentage
  let bgColor = 'bg-green-500'; // <80%
  if (percentUsed >= 100) {
    bgColor = 'bg-red-500'; // >=100%
  } else if (percentUsed >= 80) {
    bgColor = 'bg-orange-500'; // >=80%
  }

  const displayPercent = Math.min(percentUsed, 100);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-900">{label}</h3>
        <span className="text-sm text-gray-600">
          ${costUSD} / ${budgetUSD}
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all ${bgColor}`}
          style={{ width: `${displayPercent}%` }}
        />
      </div>

      {/* Percentage label */}
      <div className="mt-1 text-xs text-gray-600">
        {percentUsed}% of budget used
        {percentUsed >= 100 && (
          <span className="ml-1 font-semibold text-red-600">
            (Budget exceeded)
          </span>
        )}
      </div>
    </div>
  );
}
