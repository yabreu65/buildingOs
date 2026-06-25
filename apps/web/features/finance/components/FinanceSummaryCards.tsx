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
      label: 'Total cargado del período',
      value: formatCurrencyValue(summary.totalCharges),
      description: 'Suma de los cargos generados para el mes seleccionado.',
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-50 dark:bg-blue-950/40',
      iconColor: 'text-blue-500',
    },
    {
      label: 'Total cobrado del período',
      value: formatCurrencyValue(summary.totalPaid),
      description: 'Pagos aplicados a los cargos del mes seleccionado.',
      color: 'text-green-600 dark:text-green-400',
      bgColor: 'bg-green-50 dark:bg-green-950/40',
      iconColor: 'text-green-500',
    },
    {
      label: 'Saldo pendiente del período',
      value: formatCurrencyValue(summary.totalOutstanding),
      description: 'Deuda pendiente de los cargos del mes seleccionado.',
      color: 'text-orange-600 dark:text-orange-400',
      bgColor: 'bg-orange-50 dark:bg-orange-950/40',
      iconColor: 'text-orange-500',
    },
    {
      label: 'Unidades morosas del período',
      value: summary.delinquentUnitsCount.toString(),
      description: 'Unidades con saldo pendiente en el mes seleccionado.',
      color: 'text-red-600 dark:text-red-400',
      bgColor: 'bg-red-50 dark:bg-red-950/40',
      iconColor: 'text-red-500',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} className={`p-6 ${card.bgColor} rounded-lg border border-border`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">{card.label}</p>
            <p className="text-xs text-gray-400">{card.label.includes('Unidades morosas') ? 'unid.' : ''}</p>
          </div>
          <p className={`text-3xl font-bold ${card.color} mb-1`}>{card.value}</p>
          <p className="text-xs text-muted-foreground">{card.description}</p>
        </Card>
      ))}
    </div>
  );
}
