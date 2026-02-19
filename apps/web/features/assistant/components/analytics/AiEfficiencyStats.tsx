'use client';

/**
 * AI Efficiency Statistics
 * Shows cache hit rate, model distribution, etc.
 */

interface EfficiencyStat {
  label: string;
  value: string | number;
  unit?: string;
  color?: 'green' | 'blue' | 'purple' | 'orange';
}

interface AiEfficiencyStatsProps {
  cacheHitRate: number; // 0-100
  totalInteractions: number;
  cacheHits: number;
  smallCalls: number;
  bigCalls: number;
  mockCalls: number;
}

export function AiEfficiencyStats({
  cacheHitRate,
  totalInteractions,
  cacheHits,
  smallCalls,
  bigCalls,
  mockCalls,
}: AiEfficiencyStatsProps) {
  if (totalInteractions === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No interactions yet this month
      </div>
    );
  }

  const smallCallsPercent = Math.round(
    totalInteractions > 0 ? (smallCalls / totalInteractions) * 100 : 0,
  );
  const bigCallsPercent = Math.round(
    totalInteractions > 0 ? (bigCalls / totalInteractions) * 100 : 0,
  );
  const mockCallsPercent = Math.round(
    totalInteractions > 0 ? (mockCalls / totalInteractions) * 100 : 0,
  );

  const stats: EfficiencyStat[] = [
    {
      label: 'Cache Hit Rate',
      value: cacheHitRate,
      unit: '%',
      color: 'green',
    },
    {
      label: 'Total Interactions',
      value: totalInteractions,
      color: 'blue',
    },
    {
      label: 'Cached Responses',
      value: cacheHits,
      color: 'green',
    },
    {
      label: 'Small Model Calls',
      value: `${smallCallsPercent}%`,
      color: 'purple',
    },
    {
      label: 'Big Model Calls',
      value: `${bigCallsPercent}%`,
      color: 'orange',
    },
    {
      label: 'Mock Calls',
      value: `${mockCallsPercent}%`,
      color: 'purple',
    },
  ];

  const getColorClass = (color?: string) => {
    const colorMap: Record<string, string> = {
      green: 'bg-green-50 text-green-700',
      blue: 'bg-blue-50 text-blue-700',
      purple: 'bg-purple-50 text-purple-700',
      orange: 'bg-orange-50 text-orange-700',
    };
    return colorMap[color || 'blue'] || colorMap.blue;
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={`p-4 rounded-lg ${getColorClass(stat.color)}`}
        >
          <div className="text-xs font-medium opacity-75 mb-1">
            {stat.label}
          </div>
          <div className="text-2xl font-bold">
            {stat.value}
            {stat.unit && <span className="text-lg ml-1">{stat.unit}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
