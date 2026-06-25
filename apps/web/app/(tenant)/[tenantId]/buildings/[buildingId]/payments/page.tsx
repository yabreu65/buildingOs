'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Card from '@/shared/components/ui/Card';
import EmptyState from '@/shared/components/ui/EmptyState';
import { BuildingBreadcrumb, BuildingSubnav } from '@/features/buildings/components';
import { CreditCard } from 'lucide-react';
import { fetchBuildingById } from '@/features/buildings/services/buildings.api';
import { PaymentStatus } from '@/features/finance/services/finance.api';
import { useBuildingPayments } from '@/features/payments/hooks/useBuildingPayments';

interface BuildingParams {
  tenantId: string;
  buildingId: string;
  [key: string]: string | string[];
}

/**
 * PaymentsPage: Show building payments from the finance API
 */
export default function PaymentsPage() {
  const params = useParams<BuildingParams>();
  const tenantId = params?.tenantId;
  const buildingId = params?.buildingId;

  const [buildingName, setBuildingName] = useState<string>('');
  const {
    data: payments = [],
    isLoading: paymentsLoading,
    error: paymentsError,
  } = useBuildingPayments(buildingId);

  useEffect(() => {
    if (!tenantId || !buildingId) return;
    fetchBuildingById(tenantId, buildingId)
      .then((b) => setBuildingName(b.name))
      .catch(() => setBuildingName(''));
  }, [tenantId, buildingId]);

  if (!tenantId || !buildingId) {
    return <div>Parámetros inválidos</div>;
  }

  if (paymentsLoading) {
    return <div className="text-sm text-muted-foreground">Cargando pagos...</div>;
  }

  if (paymentsError) {
    return <div className="text-sm text-red-600">No se pudieron cargar los pagos</div>;
  }

  const statusLabelMap: Record<PaymentStatus, string> = {
    [PaymentStatus.SUBMITTED]: 'Pendiente',
    [PaymentStatus.APPROVED]: 'Aprobado',
    [PaymentStatus.REJECTED]: 'Rechazado',
    [PaymentStatus.RECONCILED]: 'Conciliado',
  };

  return (
    <div className="space-y-6">
      <BuildingBreadcrumb
        tenantId={tenantId}
        buildingName={buildingName}
        buildingId={buildingId}
        sectionName="Pagos"
      />

      <BuildingSubnav tenantId={tenantId} buildingId={buildingId} />

      {payments.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="w-12 h-12 text-muted-foreground" />}
          title="Sin registros de pago"
          description="No hay pagos registrados en este edificio."
        />
      ) : (
        <Card>
          <div className="mb-4">
            <h3 className="text-lg font-semibold">Registros de pago</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-4 font-semibold text-muted-foreground">Monto</th>
                  <th className="text-left py-2 px-4 font-semibold text-muted-foreground">Estado</th>
                  <th className="text-left py-2 px-4 font-semibold text-muted-foreground">Creado</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-b hover:bg-muted/50 transition">
                    <td className="py-3 px-4 font-medium">${payment.amount.toFixed(2)}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-xs font-medium px-2 py-1 rounded-full ${
                          payment.status === PaymentStatus.APPROVED
                            ? 'bg-green-100 text-green-700'
                            : payment.status === PaymentStatus.REJECTED
                            ? 'bg-red-100 text-red-700'
                            : 'bg-orange-100 text-orange-700'
                        }`}
                      >
                        {statusLabelMap[payment.status]}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {new Date(payment.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
