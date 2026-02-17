'use client';

import type { ReactNode } from 'react';

interface OverviewMetricWidgetProps {
  label: string;
  value: number | string;
  color?: 'default' | 'green' | 'blue' | 'red';
  icon?: ReactNode;
}

export default function OverviewMetricWidget({
  label,
  value,
  color = 'default',
  icon,
}: OverviewMetricWidgetProps) {
  const colorClasses: Record<string, string> = {
    default: 'text-gray-900',
    green: 'text-green-600',
    blue: 'text-blue-600',
    red: 'text-red-600',
  };

  return (
    <div className="border border-border rounded-lg p-6 bg-card">
      {icon && <div className="mb-3">{icon}</div>}
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`text-3xl font-bold mt-2 ${colorClasses[color]}`}>{value}</p>
    </div>
  );
}
