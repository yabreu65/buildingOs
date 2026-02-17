'use client';

import { Card, Badge, Skeleton, ErrorState, EmptyState } from '@/shared/components/ui';
import type { TicketsReport } from '../services/reports.api';

interface TicketsReportProps {
  data: TicketsReport | null;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
}

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

export function TicketsReportComponent({
  data,
  loading,
  error,
  onRetry,
}: TicketsReportProps) {
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
          <div className="text-sm text-gray-600">Respuesta Promedio</div>
          <div className="text-2xl font-bold">{data.avgTimeToFirstResponseHours}h</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-600">Resolución Promedio</div>
          <div className="text-2xl font-bold">{data.avgTimeToResolveHours}h</div>
        </Card>
      </div>

      {/* By Status */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Por Estado</h3>
        <SimpleTable
          headers={['Estado', 'Cantidad']}
          rows={data.byStatus.map((item) => [
            <Badge key={item.status} variant="outline">{item.status}</Badge>,
            item.count,
          ])}
        />
      </div>

      {/* By Priority */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Por Prioridad</h3>
        <SimpleTable
          headers={['Prioridad', 'Cantidad']}
          rows={data.byPriority.map((item) => [
            <Badge key={item.priority} variant="outline">{item.priority}</Badge>,
            item.count,
          ])}
        />
      </div>

      {/* Top Categories */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Categorías Principales</h3>
        <SimpleTable
          headers={['Categoría', 'Cantidad']}
          rows={data.topCategories.map((item) => [
            item.category,
            item.count,
          ])}
        />
      </div>
    </div>
  );
}
