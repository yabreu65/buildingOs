'use client';

import { useState } from 'react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import Badge from '@/shared/components/ui/Badge';
import Skeleton from '@/shared/components/ui/Skeleton';
import EmptyState from '@/shared/components/ui/EmptyState';
import ErrorState from '@/shared/components/ui/ErrorState';
import { Table, THead, TBody, TR, TH, TD } from '@/shared/components/ui/Table';
import DeleteConfirmDialog from '@/shared/components/ui/DeleteConfirmDialog';
import { useToast } from '@/shared/components/ui/Toast';
import { Charge, ChargeStatus } from '../../services/finance.api';
import { Plus, Trash2 } from 'lucide-react';

interface ChargesTableProps {
  charges: Charge[];
  loading: boolean;
  error: string | null;
  onCreateClick?: () => void;
  onCancelCharge?: (chargeId: string) => Promise<void>;
  onRefresh?: () => Promise<void>;
  buildingId: string;
}

const statusColors: Record<ChargeStatus, string> = {
  [ChargeStatus.PENDING]: 'bg-yellow-100 text-yellow-800',
  [ChargeStatus.PARTIAL]: 'bg-blue-100 text-blue-800',
  [ChargeStatus.PAID]: 'bg-green-100 text-green-800',
  [ChargeStatus.CANCELED]: 'bg-gray-100 text-gray-800',
};

export function ChargesTable({
  charges,
  loading,
  error,
  onRefresh,
  buildingId,
}: ChargesTableProps) {
  const [selectedChargeId, setSelectedChargeId] = useState<string | null>(null);
  const [isCanceling, setIsCanceling] = useState(false);
  const { toast } = useToast();

  if (error) {
    return <ErrorState message={error} onRetry={onRefresh} />;
  }

  if (!loading && charges.length === 0) {
    return (
      <EmptyState
        icon={<Plus className="w-12 h-12 text-muted-foreground" />}
        title="No hay cargos"
        description="Crea el primer cargo para esta unidad"
      />
    );
  }

  const handleCancelCharge = async () => {
    if (!selectedChargeId) return;
    try {
      setIsCanceling(true);
      // TODO: Call cancel function when available
      toast('Cargo cancelado', 'success');
      await onRefresh?.();
      setSelectedChargeId(null);
    } catch (err) {
      toast('Error al cancelar cargo', 'error');
    } finally {
      setIsCanceling(false);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">Cargos</h3>
          <Button disabled className="gap-2">
            <Plus className="w-4 h-4" />
            Crear cargo
          </Button>
        </div>

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
                  <TH>Unidad</TH>
                  <TH>Concepto</TH>
                  <TH>Monto</TH>
                  <TH>Vencimiento</TH>
                  <TH>Estado</TH>
                  <TH className="text-right">Acciones</TH>
                </TR>
              </THead>
              <TBody>
                {charges.map((charge) => (
                  <TR key={charge.id}>
                    <TD className="font-medium">{charge.unitId}</TD>
                    <TD>{charge.concept}</TD>
                    <TD>{charge.currency} {charge.amount.toFixed(2)}</TD>
                    <TD>{new Date(charge.dueDate).toLocaleDateString()}</TD>
                    <TD>
                      <Badge className={statusColors[charge.status]}>
                        {charge.status}
                      </Badge>
                    </TD>
                    <TD className="text-right">
                      {charge.status !== ChargeStatus.PAID && charge.status !== ChargeStatus.CANCELED && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedChargeId(charge.id)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      <DeleteConfirmDialog
        isOpen={!!selectedChargeId}
        title="Cancelar cargo"
        description="¿Estás seguro que deseas cancelar este cargo? Esta acción no se puede deshacer."
        onConfirm={handleCancelCharge}
        onCancel={() => setSelectedChargeId(null)}
        isLoading={isCanceling}
      />
    </>
  );
}
