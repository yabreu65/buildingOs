'use client';

import { useState } from 'react';
import { Trash2, Zap, CheckCircle } from 'lucide-react';
import { usePeriod, useGenerateCharges, usePublishPeriod, useDeletePeriod } from '../index';
import { ExpensePeriod } from '../services/expense-periods.api';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import Skeleton from '@/shared/components/ui/Skeleton';
import { useToast } from '@/shared/components/ui/Toast';

interface PeriodDetailProps {
  buildingId: string;
  tenantId: string;
  period: ExpensePeriod;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function PeriodDetail({
  tenantId,
  buildingId,
  period,
  onClose,
  onSuccess,
}: PeriodDetailProps) {
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: fullPeriod, isPending } = usePeriod(tenantId, buildingId, period.id);
  const { mutate: generateCharges, isPending: isGenerating } = useGenerateCharges(
    tenantId,
    buildingId,
    period.id
  );
  const { mutate: publishPeriod, isPending: isPublishing } = usePublishPeriod(
    tenantId,
    buildingId,
    period.id
  );
  const { mutate: deletePeriod, isPending: isDeleting } = useDeletePeriod(tenantId, buildingId);

  const handleGenerate = () => {
    generateCharges(undefined, {
      onSuccess: () => {
        toast('Charges generados correctamente', 'success');
        onSuccess?.();
      },
      onError: (error: any) => {
        toast(error.message || 'Error al generar charges', 'error');
      },
    });
  };

  const handlePublish = () => {
    publishPeriod(undefined, {
      onSuccess: () => {
        toast('Período publicado', 'success');
        onSuccess?.();
      },
      onError: (error: any) => {
        toast(error.message || 'Error al publicar período', 'error');
      },
    });
  };

  const handleDelete = () => {
    deletePeriod(period.id, {
      onSuccess: () => {
        toast('Período eliminado', 'success');
        onClose();
        onSuccess?.();
      },
      onError: (error: any) => {
        toast(error.message || 'Error al eliminar período', 'error');
      },
    });
  };

  if (isPending) {
    return (
      <Card className="p-4 space-y-3">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-10 w-full" />
      </Card>
    );
  }

  const charges = fullPeriod?.charges || [];
  const totalAllocated = charges.reduce((sum, c) => sum + c.amount, 0);

  const formatMonth = (year: number, month: number) => {
    const date = new Date(year, month - 1, 1);
    return date.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  };

  const formatCurrency = (amount: number) => {
    return (amount / 100).toLocaleString('es-AR', { minimumFractionDigits: 2 });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="p-4 border-l-4 border-l-blue-500">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-sm text-gray-500">Período</p>
            <p className="text-lg font-semibold">{formatMonth(period.year, period.month)}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">Estado</span>
            <span className="font-medium px-2 py-1 rounded bg-blue-100 text-blue-700">
              {period.status}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Total a prorratear</span>
            <span className="font-semibold">${formatCurrency(Number(period.totalToAllocate))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Vencimiento</span>
            <span>{new Date(period.dueDate).toLocaleDateString('es-AR')}</span>
          </div>
          {period.concept && (
            <div className="flex justify-between">
              <span className="text-gray-600">Concepto</span>
              <span>{period.concept}</span>
            </div>
          )}
        </div>
      </Card>

      {/* Charges Summary */}
      {charges.length > 0 && (
        <Card className="p-4 bg-gray-50">
          <p className="text-sm font-semibold text-gray-700 mb-2">Charges Generadas</p>
          <div className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-600">Total de cuotas</span>
              <span className="font-medium">{charges.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Total asignado</span>
              <span className="font-medium">${formatCurrency(totalAllocated)}</span>
            </div>
          </div>
        </Card>
      )}

      {/* Actions */}
      <div className="space-y-2">
        {period.status === 'DRAFT' && (
          <>
            <Button
              onClick={handleGenerate}
              disabled={isGenerating}
              variant="primary"
              className="w-full flex items-center justify-center gap-2"
            >
              <Zap className="w-4 h-4" />
              {isGenerating ? 'Generando...' : 'Generar Charges'}
            </Button>
            {!confirmDelete && (
              <Button
                onClick={() => setConfirmDelete(true)}
                variant="ghost"
                className="w-full text-red-600 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Eliminar
              </Button>
            )}
            {confirmDelete && (
              <div className="p-3 bg-red-50 rounded border border-red-200 space-y-2">
                <p className="text-sm text-red-700 font-medium">¿Eliminar período?</p>
                <div className="flex gap-2">
                  <Button
                    onClick={handleDelete}
                    disabled={isDeleting}
                    variant="ghost"
                    className="flex-1 text-red-600 hover:bg-red-100"
                    size="sm"
                  >
                    {isDeleting ? 'Eliminando...' : 'Confirmar'}
                  </Button>
                  <Button
                    onClick={() => setConfirmDelete(false)}
                    variant="ghost"
                    className="flex-1"
                    size="sm"
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {period.status === 'GENERATED' && (
          <Button
            onClick={handlePublish}
            disabled={isPublishing}
            variant="primary"
            className="w-full flex items-center justify-center gap-2"
          >
            <CheckCircle className="w-4 h-4" />
            {isPublishing ? 'Publicando...' : 'Publicar Período'}
          </Button>
        )}

        {period.status === 'PUBLISHED' && (
          <Card className="p-3 bg-green-50 border-l-4 border-l-green-500">
            <p className="text-sm font-medium text-green-700">
              ✓ Período publicado
            </p>
            <p className="text-xs text-green-600 mt-1">
              Los residentes pueden ver sus cuotas
            </p>
          </Card>
        )}
      </div>

      {/* Charges List */}
      {charges.length > 0 && (
        <Card className="p-4">
          <p className="text-sm font-semibold text-gray-700 mb-3">Detalle de Cuotas</p>
          <div className="space-y-2 max-h-64 overflow-y-auto text-xs">
            {charges.map((charge) => (
              <div key={charge.id} className="flex justify-between p-2 bg-gray-50 rounded">
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{charge.unitCode}</p>
                  <p className="text-gray-500 text-xs">{charge.unitLabel || 'Sin etiqueta'}</p>
                </div>
                <p className="font-semibold text-gray-900">
                  ${formatCurrency(charge.amount)}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
