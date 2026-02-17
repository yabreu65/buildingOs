'use client';

import { Card, Skeleton, ErrorState, EmptyState } from '@/shared/components/ui';
import type { ActivityReport } from '../services/reports.api';

interface ActivityReportProps {
  data: ActivityReport | null;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
}

export function ActivityReportComponent({
  data,
  loading,
  error,
  onRetry,
}: ActivityReportProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
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
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card className="p-6 text-center">
        <div className="text-4xl font-bold text-blue-600">{data.ticketsCreated}</div>
        <div className="text-sm text-gray-600 mt-2">Tickets Creados</div>
      </Card>
      <Card className="p-6 text-center">
        <div className="text-4xl font-bold text-green-600">{data.paymentsSubmitted}</div>
        <div className="text-sm text-gray-600 mt-2">Pagos Enviados</div>
      </Card>
      <Card className="p-6 text-center">
        <div className="text-4xl font-bold text-purple-600">{data.documentsUploaded}</div>
        <div className="text-sm text-gray-600 mt-2">Documentos Cargados</div>
      </Card>
      <Card className="p-6 text-center">
        <div className="text-4xl font-bold text-orange-600">{data.communicationsSent}</div>
        <div className="text-sm text-gray-600 mt-2">Comunicaciones Enviadas</div>
      </Card>
    </div>
  );
}
