'use client';

import { Card } from '@/shared/components/ui/card';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { ErrorState } from '@/shared/components/ui/error-state';
import { FinancialSummary } from '../../services/finance.api';
import { formatCurrency } from '@/shared/lib/format';

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

  const cards = [
    {
      label: 'Total Cargos',
      value: formatCurrency(summary.totalCharges, summary.currency),
      color: 'text-blue-600',
    },
    {
      label: 'Total Pagado',
      value: formatCurrency(summary.totalPaid, summary.currency),
      color: 'text-green-600',
    },
    {
      label: 'Saldo Pendiente',
      value: formatCurrency(summary.totalOutstanding, summary.currency),
      color: 'text-orange-600',
    },
    {
      label: 'Unidades Morosas',
      value: summary.delinquentUnitsCount.toString(),
      color: 'text-red-600',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} className="p-4">
          <p className="text-sm font-medium text-gray-600">{card.label}</p>
          <p className={`text-2xl font-bold ${card.color} mt-2`}>{card.value}</p>
        </Card>
      ))}
    </div>
  );
}
