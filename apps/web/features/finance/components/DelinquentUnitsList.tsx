'use client';

import Card from '@/shared/components/ui/Card';
import Skeleton from '@/shared/components/ui/Skeleton';
import EmptyState from '@/shared/components/ui/EmptyState';
import { Table, THead, TBody, TR, TH, TD } from '@/shared/components/ui/Table';
import { AlertCircle } from 'lucide-react';
import { formatCurrencyBuckets } from '@/shared/lib/format/currency-buckets';
import type { CurrencyAmountBucket } from '@/features/finance/services/finance.api';

interface DelinquentUnit {
  unitId: string;
  unitLabel: string;
  buildingName: string;
  outstandingByCurrency: CurrencyAmountBucket[];
}

interface DelinquentUnitsListProps {
  units: DelinquentUnit[];
  loading: boolean;
}

/**
 * DelinquentUnitsList: Display units with outstanding payments per currency.
 * Amounts are in minor units; each currency is shown explicitly.
 */
export function DelinquentUnitsList({
  units,
  loading,
}: DelinquentUnitsListProps) {
  if (!loading && units.length === 0) {
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
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Edificio</TH>
              <TH>Unidad</TH>
              <TH className="text-right">Deuda Pendiente</TH>
            </TR>
          </THead>
          <TBody>
            {units.map((unit) => (
              <TR key={unit.unitId}>
                <TD className="font-medium text-sm">{unit.buildingName}</TD>
                <TD className="font-medium">{unit.unitLabel}</TD>
                <TD className="text-right font-semibold text-red-600">
                  {formatCurrencyBuckets(unit.outstandingByCurrency)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
