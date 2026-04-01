'use client';

import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import Button from '@/shared/components/ui/Button';
import { useToast } from '@/shared/components/ui/Toast';
import {
  useLiquidations,
  useCreateLiquidationDraft,
} from '../hooks/useExpenseLedger';
import { LiquidationCard } from './LiquidationCard';

interface LiquidationsTabProps {
  tenantId: string;
  buildingId: string;
  period: string;
  currency: string;
}

export function LiquidationsTab({
  tenantId,
  buildingId,
  period,
  currency,
}: LiquidationsTabProps) {
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);

  const {
    data: liquidations = [],
    isPending,
    refetch,
  } = useLiquidations(tenantId, { buildingId, period: period || undefined });

  const createDraftMutation = useCreateLiquidationDraft(tenantId);

  const handleCreateDraft = async () => {
    if (!period) {
      toast('Seleccioná un período antes de generar la liquidación', 'error');
      return;
    }
    setCreating(true);
    try {
      await createDraftMutation.mutateAsync({
        buildingId,
        period,
        baseCurrency: currency,
      });
      toast('Borrador de liquidación creado', 'success');
      void refetch();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Error al crear la liquidación';
      toast(msg, 'error');
    } finally {
      setCreating(false);
    }
  };

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">
            Liquidaciones{period ? ` — ${period}` : ''}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Generá una liquidación sumando los gastos VALIDADOS del período.
          </p>
        </div>
        <Button
          size="sm"
          onClick={handleCreateDraft}
          disabled={creating || !period}
        >
          {creating ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <Plus className="h-4 w-4 mr-1" />
          )}
          Generar borrador
        </Button>
      </div>

      {/* Lista */}
      {liquidations.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          No hay liquidaciones para este período.
          <br />
          <span className="text-xs">
            Primero registrá y validá los gastos, luego generá el borrador.
          </span>
        </div>
      ) : (
        <div className="space-y-3">
          {liquidations.map((liq) => (
            <LiquidationCard
              key={liq.id}
              tenantId={tenantId}
              liquidation={liq}
              onRefresh={() => void refetch()}
            />
          ))}
        </div>
      )}
    </div>
  );
}
