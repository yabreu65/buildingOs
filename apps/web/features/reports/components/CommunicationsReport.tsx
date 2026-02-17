'use client';

import { Card, Skeleton, ErrorState, EmptyState } from '@/shared/components/ui';
import type { CommunicationsReport } from '../services/reports.api';

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

interface CommunicationsReportProps {
  data: CommunicationsReport | null;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
}

export function CommunicationsReportComponent({
  data,
  loading,
  error,
  onRetry,
}: CommunicationsReportProps) {
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-sm text-gray-600">Total de Destinatarios</div>
          <div className="text-2xl font-bold">{data.totalRecipients}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-600">Lecturas</div>
          <div className="text-2xl font-bold text-green-600">{data.totalRead}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-600">Tasa de Lectura</div>
          <div className="text-2xl font-bold text-blue-600">{data.readRate}%</div>
        </Card>
      </div>

      {/* By Channel */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Por Canal</h3>
        <SimpleTable
          headers={['Canal', 'Enviados', 'Leídos', 'Tasa de Lectura']}
          rows={data.byChannel.map((item) => [
            <span key={item.channel} className="capitalize">{item.channel.toLowerCase()}</span>,
            item.sent,
            item.read,
            <span key={`rate-${item.channel}`} className="text-blue-600 font-semibold">{item.readRate}%</span>,
          ])}
        />
      </div>
    </div>
  );
}
