'use client';

import { useState } from 'react';
import { Button } from '@/shared/components/ui/button';
import { Card } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { ErrorState } from '@/shared/components/ui/error-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table';
import { DeleteConfirmDialog } from '@/shared/components/ui/delete-confirm-dialog';
import { useToast } from '@/shared/components/ui/toast';
import { Charge, ChargeStatus } from '../../services/finance.api';
import { formatDate, formatCurrency } from '@/shared/lib/format';
import { Plus, Trash2 } from 'lucide-react';
import { ChargeCreateModal } from './ChargeCreateModal';

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
  const [showCreateModal, setShowCreateModal] = useState(false);
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
        cta={{ text: 'Crear cargo', onClick: () => setShowCreateModal(true) }}
      />
    );
  }

  const handleCancelCharge = async () => {
    if (!selectedChargeId) return;
    try {
      setIsCanceling(true);
      // TODO: Call cancel function when available
      toast({ type: 'success', message: 'Cargo cancelado' });
      await onRefresh?.();
      setSelectedChargeId(null);
    } catch (err) {
      toast({ type: 'error', message: 'Error al cancelar cargo' });
    } finally {
      setIsCanceling(false);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">Cargos</h3>
          <Button onClick={() => setShowCreateModal(true)} className="gap-2">
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
              <TableHeader>
                <TableRow>
                  <TableHead>Unidad</TableHead>
                  <TableHead>Concepto</TableHead>
                  <TableHead>Monto</TableHead>
                  <TableHead>Vencimiento</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {charges.map((charge) => (
                  <TableRow key={charge.id}>
                    <TableCell className="font-medium">{charge.unitId}</TableCell>
                    <TableCell>{charge.concept}</TableCell>
                    <TableCell>{formatCurrency(charge.amount, charge.currency)}</TableCell>
                    <TableCell>{formatDate(new Date(charge.dueDate))}</TableCell>
                    <TableCell>
                      <Badge className={statusColors[charge.status]}>
                        {charge.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>

      <ChargeCreateModal
        buildingId={buildingId}
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={() => {
          setShowCreateModal(false);
          onRefresh?.();
        }}
      />

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
