'use client';

import { Calendar, Zap, FileText } from 'lucide-react';
import { usePeriods } from '../index';
import { ExpensePeriod } from '../services/expense-periods.api';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import Skeleton from '@/shared/components/ui/Skeleton';

interface PeriodsListProps {
  buildingId: string;
  onCreateClick: () => void;
  onPeriodClick: (period: ExpensePeriod) => void;
}

export default function PeriodsList({
  buildingId,
  onCreateClick,
  onPeriodClick,
}: PeriodsListProps) {
  const { data: periods, isPending, error } = usePeriods(buildingId);

  if (isPending) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="bg-red-50 border-red-200">
        <p className="text-sm text-red-700">Error al cargar períodos</p>
      </Card>
    );
  }

  // Group by status
  const draft = periods.filter((p) => p.status === 'DRAFT');
  const generated = periods.filter((p) => p.status === 'GENERATED');
  const published = periods.filter((p) => p.status === 'PUBLISHED');

  const formatMonth = (year: number, month: number) => {
    const date = new Date(year, month - 1, 1);
    return date.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  };

  const renderPeriodCard = (period: ExpensePeriod) => (
    <Card
      key={period.id}
      onClick={() => onPeriodClick(period)}
      className="cursor-pointer hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-4 h-4 text-gray-500" />
            <p className="font-semibold">{formatMonth(period.year, period.month)}</p>
            <span className="text-xs font-semibold px-2 py-1 rounded bg-blue-100 text-blue-700">
              {period.status}
            </span>
          </div>
          <p className="text-sm text-gray-600 mb-1">{period.concept}</p>
          <p className="text-xs text-gray-500">
            Vencimiento: {new Date(period.dueDate).toLocaleDateString('es-AR')}
          </p>
        </div>
        <div className="text-right">
          <p className="font-semibold text-lg">
            ${(period.totalToAllocate / 100).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-gray-500">{period.currency}</p>
        </div>
      </div>
    </Card>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Períodos de Gastos</h3>
        <Button size="sm" onClick={onCreateClick}>
          <FileText className="w-4 h-4 mr-2" />
          Nuevo Período
        </Button>
      </div>

      {/* DRAFT */}
      {draft.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2 uppercase">
            Borradores ({draft.length})
          </h4>
          <div className="space-y-2">{draft.map(renderPeriodCard)}</div>
        </div>
      )}

      {/* GENERATED */}
      {generated.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2 uppercase">
            Generados ({generated.length})
          </h4>
          <div className="space-y-2">{generated.map(renderPeriodCard)}</div>
        </div>
      )}

      {/* PUBLISHED */}
      {published.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2 uppercase">
            Publicados ({published.length})
          </h4>
          <div className="space-y-2">{published.map(renderPeriodCard)}</div>
        </div>
      )}

      {/* Empty State */}
      {periods.length === 0 && (
        <Card className="text-center py-8">
          <Zap className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Sin períodos. Crea uno para empezar la asignación.</p>
        </Card>
      )}
    </div>
  );
}
