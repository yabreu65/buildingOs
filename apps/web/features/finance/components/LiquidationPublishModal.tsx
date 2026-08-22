'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
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
  const dueDateFieldId = 'liquidation-publish-due-date';
  const dialogRef = useRef<HTMLDivElement>(null);
  const dueDateInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Default: fin del mes del período
  const defaultDueDate = (() => {
    const [year, month] = period.split('-').map(Number);
    if (!year || !month) return '';
    const lastDay = new Date(year, month, 0).getDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  })();

  const [dueDate, setDueDate] = useState(defaultDueDate);

  // Al abrir el diálogo: recordar qué elemento lo disparó y mover el foco al
  // primer control del diálogo (la fecha de vencimiento).
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    dueDateInputRef.current?.focus();
  }, []);

  // Al cerrar (desmontar): restaurar el foco al trigger que abrió el diálogo.
  useEffect(() => {
    return () => {
      previousFocusRef.current?.focus?.();
    };
  }, []);

  // Si la publicación pasa a estado pending, puede deshabilitarse el control
  // que tenía el foco: devolverlo al diálogo para mantener la contención.
  useEffect(() => {
    if (!publishMutation.isPending) {
      return;
    }
    const active = document.activeElement;
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (!(active instanceof HTMLElement) || !dialog.contains(active) || (active as HTMLInputElement).disabled) {
      dialog.focus();
    }
  }, [publishMutation.isPending]);

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

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();

      if (!publishMutation.isPending) {
        onClose();
      }

      return;
    }

    if (event.key === 'Tab') {
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );

      if (!focusable || focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement as HTMLElement | null;

      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="liquidation-publish-title"
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        className="w-full max-w-sm bg-background rounded-xl shadow-xl outline-none"
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 id="liquidation-publish-title" className="text-lg font-semibold">
              Publicar liquidación
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={publishMutation.isPending}
              aria-label="Cerrar diálogo de publicación de liquidación"
              className="p-1 rounded hover:bg-muted disabled:opacity-50"
            >
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
            <div className="max-h-[40vh] overflow-y-auto">
              <label htmlFor={dueDateFieldId} className="block text-sm font-medium mb-1">
                Fecha de vencimiento <span className="text-red-500">*</span>
              </label>
              <input
                id={dueDateFieldId}
                ref={dueDateInputRef}
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={publishMutation.isPending}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={onClose} disabled={publishMutation.isPending}>
                Cancelar
              </Button>
              <Button
                onClick={handlePublish}
                disabled={publishMutation.isPending}
              >
                {publishMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : null}
                {publishMutation.isPending ? 'Publicando...' : 'Publicar liquidación'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
