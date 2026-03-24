'use client';

import Card from '@/shared/components/ui/Card';
import { Table, THead, TBody, TR, TH, TD } from '@/shared/components/ui/Table';
import EmptyState from '@/shared/components/ui/EmptyState';
import Skeleton from '@/shared/components/ui/Skeleton';
import { AlertCircle } from 'lucide-react';

interface TenantDelinquentUnitsListProps {
  delinquent: Array<{ unitId: string; outstanding: number }>;
  loading: boolean;
}

export const TenantDelinquentUnitsList = ({ delinquent, loading }: TenantDelinquentUnitsListProps) => {
  if (!loading && delinquent.length === 0) {
    return (
      <EmptyState
        icon={<AlertCircle className="w-12 h-12 text-muted-foreground" />}
        title="No hay unidades morosas"
        description="Todas las unidades están al día"
      />
    );
  }

  return (
    <Card>
      {loading ? (
        <div className="p-4 space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Unidad</TH>
              <TH className="text-right">Deuda Pendiente</TH>
            </TR>
          </THead>
          <TBody>
            {delinquent.map((item) => (
              <TR key={item.unitId}>
                <TD className="font-medium">{item.unitId}</TD>
                <TD className="text-right font-semibold text-red-600">
                  ARS {item.outstanding.toFixed(2)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
};
