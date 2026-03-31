'use client';

import Card from '@/shared/components/ui/Card';
import Skeleton from '@/shared/components/ui/Skeleton';
import ErrorState from '@/shared/components/ui/ErrorState';
import { FinancialSummary } from '../services/finance.api';
import { formatCurrency } from '@/shared/lib/format/money';

interface FinanceSummaryCardsProps {
  summary: FinancialSummary | null;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
}

export function FinanceSummaryCards({
  summary,
  loading,
  error,
  onRetry,
}: FinanceSummaryCardsProps) {
  if (error) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }

  if (loading || !summary) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="p-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-32" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  // Format currency using the standardized helper (amounts are stored in cents)
  const formatCurrencyValue = (cents: number): string => formatCurrency(cents, summary.currency);

  const cards = [
    {
      label: 'Total Cargos',
      value: formatCurrencyValue(summary.totalCharges),
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      label: 'Total Pagado',
      value: formatCurrencyValue(summary.totalPaid),
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      label: 'Saldo Pendiente',
      value: formatCurrencyValue(summary.totalOutstanding),
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
    },
    {
      label: 'Unidades Morosas',
      value: summary.delinquentUnitsCount.toString(),
      color: 'text-red-600',
      bgColor: 'bg-red-50',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} className={`p-6 ${card.bgColor} rounded-lg border border-gray-200`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-500">{card.label}</p>
            <p className="text-xs text-gray-400">{card.label === 'Unidades Morosas' ? 'unid.' : ''}</p>
          </div>
          <p className={`text-3xl font-bold ${card.color} mb-1`}>{card.value}</p>
        </Card>
      ))}
    </div>
  );
}
