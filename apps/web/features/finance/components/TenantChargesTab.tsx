'use client';

import { useQuery } from '@tanstack/react-query';
import Card from '@/shared/components/ui/Card';
import { Skeleton } from '@/shared/components/ui';
import { cn } from '@/shared/lib/utils';

interface Charge {
  id: string;
  buildingId: string;
  unitId: string;
  amount: number;
  dueDate: string;
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'CANCELED';
  createdAt: string;
}

interface TenantChargesTabProps {
  tenantId: string;
  buildingNames: Record<string, string>;
}

const statusColors: Record<Charge['status'], string> = {
  PENDING: 'text-orange-600 bg-orange-50',
  PARTIAL: 'text-blue-600 bg-blue-50',
  PAID: 'text-green-600 bg-green-50',
  CANCELED: 'text-gray-600 bg-gray-50',
};

const statusLabels: Record<Charge['status'], string> = {
  PENDING: 'Pendiente',
  PARTIAL: 'Parcial',
  PAID: 'Pagado',
  CANCELED: 'Cancelado',
};

export const TenantChargesTab = ({ tenantId, buildingNames }: TenantChargesTabProps) => {
  // TODO: Replace with actual API call when endpoint is available
  // For now, using empty state pattern
  const { data: charges = [], isLoading } = useQuery<Charge[]>({
    queryKey: ['tenantCharges', tenantId],
    queryFn: async () => {
      // Placeholder until GET /tenants/:tenantId/finance/charges is implemented
      return [];
    },
    enabled: !!tenantId,
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  }

  if (charges.length === 0) {
    return (
      <Card>
        <div className="p-6 text-center text-gray-600">
          <p className="text-sm">No hay cargos</p>
          <p className="text-xs text-muted-foreground mt-2">Los cargos aparecerán aquí cuando se creen</p>
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
              <p className="text-sm font-medium">{buildingNames[charge.buildingId] || charge.buildingId}</p>
              <p className="text-xs text-muted-foreground">Unidad: {charge.unitId}</p>
              <p className="text-xs text-muted-foreground">
                Vencimiento: {new Date(charge.dueDate).toLocaleDateString('es-AR')}
              </p>
            </div>
            <div className="text-right space-y-2">
              <p className="text-sm font-bold">${charge.amount.toFixed(2)}</p>
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
