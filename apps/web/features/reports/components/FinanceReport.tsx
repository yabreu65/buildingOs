'use client';

import { Card, Skeleton, ErrorState, EmptyState } from '@/shared/components/ui';
import type { FinanceReport } from '../services/reports.api';

// Simple table-like div layout
function SimpleTable({ headers, rows }: { headers: string[], rows: React.ReactNode[][] }) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="bg-muted text-muted-foreground border-b">
        <div className="grid gap-4 p-3" style={{ gridTemplateColumns: `repeat(${headers.length}, 1fr)` }}>
          {headers.map((h) => <div key={h} className="font-semibold text-sm">{h}</div>)}
        </div>
      </div>
      <div>
        {rows.map((row, i) => (
          <div key={i} className="grid gap-4 p-3 border-b last:border-b-0" style={{ gridTemplateColumns: `repeat(${headers.length}, 1fr)` }}>
            {row.map((cell, j) => <div key={j} className="text-sm">{cell}</div>)}
          </div>
        ))}
      </div>
    </div>
  );
}

interface FinanceReportProps {
  data: FinanceReport | null;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
}

// Format amount from cents to display string
function formatAmount(cents: number): string {
  return (cents / 100).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function FinanceReportComponent({
  data,
  loading,
  error,
  onRetry,
}: FinanceReportProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }

  if (!data) {
    return <EmptyState title="Sin datos" description="No hay datos disponibles" />;
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-sm text-gray-600">Total Facturado</div>
          <div className="text-2xl font-bold">${formatAmount(data.totalCharges)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-600">Total Cobrado</div>
          <div className="text-2xl font-bold text-green-600">${formatAmount(data.totalPaid)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-600">Pendiente</div>
          <div className="text-2xl font-bold text-orange-600">${formatAmount(data.totalOutstanding)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-600">Tasa de Cobranza</div>
          <div className="text-2xl font-bold text-blue-600">{data.collectionRate}%</div>
        </Card>
      </div>

      {/* Delinquent Units */}
      {data.delinquentUnitsCount > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">
            Unidades Morosas ({data.delinquentUnitsCount})
          </h3>
          <SimpleTable
            headers={['Unidad', 'Monto Pendiente']}
            rows={data.delinquentUnits.map((item) => [
              item.unitId,
              <span key={item.unitId} className="text-orange-600 font-semibold">
                ${formatAmount(item.outstanding)}
              </span>,
            ])}
          />
        </div>
      )}

      {data.delinquentUnitsCount === 0 && (
        <EmptyState
          title="Sin deudores"
          description="No hay unidades con cargos vencidos"
        />
      )}
    </div>
  );
}
