'use client';

import { useState } from 'react';
import { X, Loader2, AlertTriangle } from 'lucide-react';
import Button from '@/shared/components/ui/Button';
import { useToast } from '@/shared/components/ui/Toast';
import { formatCurrency } from '@/shared/lib/format/money';
import { usePublishLiquidation } from '../hooks/useExpenseLedger';

interface LiquidationPublishModalProps {
  tenantId: string;
  liquidationId: string;
  period: string;
  totalAmountMinor: number;
  baseCurrency: string;
  unitCount: number;
  onClose: () => void;
  onPublished: () => void;
}

export function LiquidationPublishModal({
  tenantId,
  liquidationId,
  period,
  totalAmountMinor,
  baseCurrency,
  unitCount,
  onClose,
  onPublished,
}: LiquidationPublishModalProps) {
  const { toast } = useToast();
  const publishMutation = usePublishLiquidation(tenantId);

  // Default: fin del mes del período
  const defaultDueDate = (() => {
    const [year, month] = period.split('-').map(Number);
    if (!year || !month) return '';
    const lastDay = new Date(year, month, 0).getDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  })();

  const [dueDate, setDueDate] = useState(defaultDueDate);

  const handlePublish = async () => {
    if (!dueDate) {
      toast('Seleccioná una fecha de vencimiento', 'error');
      return;
    }

    try {
      await publishMutation.mutateAsync({ liquidationId, dueDate });
      toast(
        `Liquidación publicada — ${unitCount} cargos generados`,
        'success',
      );
      onPublished();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Error al publicar la liquidación';
      toast(msg, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Publicar liquidación</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Resumen */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Período</span>
              <span className="font-medium">{period}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total a distribuir</span>
              <span className="font-mono font-medium">
                {formatCurrency(totalAmountMinor, baseCurrency)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Unidades a cobrar</span>
              <span className="font-medium">{unitCount}</span>
            </div>
          </div>

          {/* Advertencia */}
          <div className="flex gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg p-3">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <p>
              Al publicar se crearán <strong>{unitCount} cargos</strong> para
              los residentes. Esta acción no se puede deshacer si ya hay pagos
              aprobados.
            </p>
          </div>

          {/* Fecha de vencimiento */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Fecha de vencimiento <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              onClick={handlePublish}
              disabled={publishMutation.isPending}
            >
              {publishMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              Publicar liquidación
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
