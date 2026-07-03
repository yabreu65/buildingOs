'use client';

import { useQuery } from '@tanstack/react-query';
import Card from '@/shared/components/ui/Card';
import { Skeleton } from '@/shared/components/ui';
import Button from '@/shared/components/ui/Button';
import { cn } from '@/shared/lib/utils';
import { formatCurrency } from '@/shared/lib/format/money';
import { listTenantCharges, type TenantCharge } from '../services/expense-ledger.api';

interface TenantChargesTabProps {
  tenantId: string;
  buildingNames: Record<string, string>;
}

const statusColors: Record<TenantCharge['status'], string> = {
  PENDING: 'text-orange-600 bg-orange-50',
  PARTIAL: 'text-blue-600 bg-blue-50',
  PAID: 'text-green-600 bg-green-50',
  CANCELED: 'text-gray-600 bg-gray-50',
};

const statusLabels: Record<TenantCharge['status'], string> = {
  PENDING: 'Pendiente',
  PARTIAL: 'Parcial',
  PAID: 'Pagado',
  CANCELED: 'Cancelado',
};

export const TenantChargesTab = ({ tenantId, buildingNames }: TenantChargesTabProps) => {
  const { data: charges = [], isLoading, error, refetch } = useQuery<TenantCharge[]>({
    queryKey: ['tenantCharges', tenantId],
    queryFn: () => listTenantCharges(tenantId),
    enabled: !!tenantId,
    staleTime: 2 * 60 * 1000,
  });

  const errorMessage = error instanceof Error ? error.message : error ? String(error) : null;

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  }

  if (errorMessage) {
    return (
      <Card className="border-red-200 bg-red-50 p-4">
        <div className="space-y-3 text-center text-red-700">
          <p className="text-sm font-medium text-red-900">No pudimos cargar los cargos del conjunto</p>
          <p className="text-sm">{errorMessage}</p>
          <Button size="sm" variant="secondary" onClick={() => void refetch()}>
            Reintentar
          </Button>
        </div>
      </Card>
    );
  }

  if (charges.length === 0) {
    return (
      <Card>
        <div className="p-6 text-center text-gray-600">
          <p className="text-sm">No hay cargos para mostrar</p>
          <p className="text-xs text-muted-foreground mt-2">
            Los cargos aparecerán aquí cuando la liquidación publique la deuda del período.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {charges.map((charge) => (
        <Card key={charge.id} className="p-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1 flex-1">
              <p className="text-sm font-medium">{charge.building?.name || buildingNames[charge.buildingId] || charge.buildingId}</p>
              <p className="text-xs text-muted-foreground">Unidad: {charge.unit?.label || charge.unitId}</p>
              <p className="text-xs text-muted-foreground">
                Vencimiento: {new Date(charge.dueDate).toLocaleDateString('es-AR')}
              </p>
            </div>
            <div className="text-right space-y-2">
              <p className="text-sm font-bold">{formatCurrency(charge.amount, charge.currency || 'USD')}</p>
              <span className={cn('text-xs font-medium px-2 py-1 rounded', statusColors[charge.status])}>
                {statusLabels[charge.status]}
              </span>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};
