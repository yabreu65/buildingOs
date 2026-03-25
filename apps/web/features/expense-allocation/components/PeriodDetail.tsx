'use client';

import { useState } from 'react';
import {
  Zap,
  FileText,
  Check,
  AlertCircle,
  Loader,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { usePeriod, useGenerateCharges, usePublishPeriod, useDeletePeriod } from '../index';
import { ExpensePeriod, ExpensePeriodStatus } from '../services/expense-periods.api';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import Skeleton from '@/shared/components/ui/Skeleton';
import { useToast } from '@/shared/components/ui/Toast';

interface PeriodDetailProps {
  buildingId: string;
  period: ExpensePeriod;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function PeriodDetail({
  buildingId,
  period,
  onClose,
  onSuccess,
}: PeriodDetailProps) {
  const { toast } = useToast();
  const { data: fullPeriod, isPending: isLoading, error } = usePeriod(buildingId, period.id);
  const { mutateAsync: generateCharges, isPending: isGenerating } = useGenerateCharges(
    buildingId,
    period.id
  );
  const { mutateAsync: publishPeriod, isPending: isPublishing } = usePublishPeriod(
    buildingId,
    period.id
  );
  const { mutateAsync: deletePeriod, isPending: isDeleting } = useDeletePeriod(buildingId);

  const [expandedCharges, setExpandedCharges] = useState(false);
  const [actionError, setActionError] = useState<string>('');

  const handleGenerate = async () => {
    if (!confirm('¿Generar charges para este período?')) return;
    try {
      setActionError('');
      await generateCharges();
      toast('Charges generados correctamente', 'success');
      onSuccess?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al generar charges';
      setActionError(msg);
      toast('Error al generar charges', 'error');
    }
  };

  const handlePublish = async () => {
    if (!confirm('¿Publicar este período? Será visible para residentes.')) return;
    try {
      setActionError('');
      await publishPeriod();
      toast('Período publicado', 'success');
      onSuccess?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al publicar período';
      setActionError(msg);
      toast('Error al publicar período', 'error');
    }
  };

  const handleDelete = async () => {
    if (!confirm('¿Eliminar este período? Esta acción no se puede deshacer.')) return;
    try {
      setActionError('');
      await deletePeriod(period.id);
      toast('Período eliminado', 'success');
      onClose();
      onSuccess?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al eliminar período';
      setActionError(msg);
      toast('Error al eliminar período', 'error');
    }
  };

  if (isLoading) {
    return (
      <Card className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-red-50 border-red-200">
        <div className="flex gap-2">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-700">Error al cargar período</p>
            <p className="text-xs text-red-600">{error.message}</p>
          </div>
        </div>
      </Card>
    );
  }

  if (!fullPeriod) return null;

  const chargesCount = fullPeriod.charges?.length || 0;
  const totalAmount =
    fullPeriod.charges?.reduce((sum, c) => sum + c.amount, 0) || fullPeriod.totalToAllocate;
  const canGenerate = fullPeriod.status === 'DRAFT';
  const canPublish = fullPeriod.status === 'GENERATED';
  const canDelete = fullPeriod.status === 'DRAFT';
  const isActionInProgress = isGenerating || isPublishing || isDeleting;

  const formatMonth = (year: number, month: number) => {
    const date = new Date(year, month - 1, 1);
    return date.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  };

  const getStatusColor = (status: ExpensePeriodStatus) => {
    const colors = {
      DRAFT: 'bg-yellow-50 border-yellow-200 text-yellow-700',
      GENERATED: 'bg-blue-50 border-blue-200 text-blue-700',
      PUBLISHED: 'bg-green-50 border-green-200 text-green-700',
      CLOSED: 'bg-gray-50 border-gray-200 text-gray-700',
    };
    return colors[status] || colors.DRAFT;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className={`border-2 ${getStatusColor(fullPeriod.status)}`}>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{formatMonth(fullPeriod.year, fullPeriod.month)}</h3>
            <span className="text-xs font-semibold px-2 py-1 rounded bg-white/50">
              {fullPeriod.status}
            </span>
          </div>
          <p className="text-sm">{fullPeriod.concept}</p>
          <p className="text-xs opacity-75">Vencimiento: {new Date(fullPeriod.dueDate).toLocaleDateString('es-AR')}</p>
        </div>
      </Card>

      {/* Amount Summary */}
      <Card>
        <div className="grid grid-cols-2 gap-4 text-center">
          <div>
            <p className="text-xs text-gray-500 mb-1">A Distribuir</p>
            <p className="text-lg font-semibold">
              ${(fullPeriod.totalToAllocate / 100).toLocaleString('es-AR', {
                minimumFractionDigits: 2,
              })}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Charges</p>
            <p className="text-lg font-semibold">{chargesCount}</p>
          </div>
        </div>
      </Card>

      {/* Action Error */}
      {actionError && (
        <Card className="bg-red-50 border-red-200 flex gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{actionError}</p>
        </Card>
      )}

      {/* Charges List */}
      {chargesCount > 0 && (
        <Card>
          <button
            onClick={() => setExpandedCharges(!expandedCharges)}
            className="w-full flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg transition"
          >
            <span className="text-sm font-semibold">Charges ({chargesCount})</span>
            {expandedCharges ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>

          {expandedCharges && (
            <div className="border-t divide-y max-h-64 overflow-y-auto">
              {fullPeriod.charges?.map((charge) => (
                <div key={charge.id} className="p-3 text-sm space-y-1">
                  <p className="font-medium">{charge.unitId}</p>
                  <p className="text-gray-600">
                    ${(charge.amount / 100).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </p>
                  {charge.coefficientSnapshot && (
                    <p className="text-xs text-gray-500">
                      Coef: {charge.coefficientSnapshot.toFixed(2)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Actions */}
      <div className="space-y-2">
        {canGenerate && (
          <Button
            onClick={handleGenerate}
            disabled={isActionInProgress}
            className="w-full flex items-center justify-center gap-2"
          >
            {isGenerating ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Generando...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                Generar Charges
              </>
            )}
          </Button>
        )}

        {canPublish && (
          <Button
            onClick={handlePublish}
            disabled={isActionInProgress}
            className="w-full flex items-center justify-center gap-2"
          >
            {isPublishing ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Publicando...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                Publicar
              </>
            )}
          </Button>
        )}

        {canDelete && (
          <Button
            onClick={handleDelete}
            disabled={isActionInProgress}
            variant="secondary"
            className="w-full text-red-600 hover:bg-red-50"
          >
            {isDeleting ? 'Eliminando...' : 'Eliminar'}
          </Button>
        )}

        <Button
          onClick={onClose}
          variant="secondary"
          disabled={isActionInProgress}
          className="w-full"
        >
          Cerrar
        </Button>
      </div>
    </div>
  );
}
