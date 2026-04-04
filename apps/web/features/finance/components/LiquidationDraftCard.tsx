'use client';

import { useState } from 'react';
import { formatCurrency } from '@/shared/lib/format/money';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import Badge from '@/shared/components/ui/Badge';
import { AlertCircle, FileText, CheckCircle2, Trash2, Loader2 } from 'lucide-react';
import {
  useReviewLiquidation,
  usePublishLiquidation,
  useCancelLiquidation,
} from '../hooks/useLiquidation';
import PublishLiquidationModal from './PublishLiquidationModal';

interface LiquidationDraftCardProps {
  tenantId: string;
  liquidation: {
    id: string;
    buildingId: string;
    period: string;
    status: 'DRAFT' | 'REVIEWED' | 'PUBLISHED' | 'CANCELED';
    baseCurrency: string;
    totalAmountMinor: number;
    unitCount: number;
    generatedAt: string;
  };
  expenses: Array<{
    id: string;
    categoryName: string;
    vendorName: string | null;
    amountMinor: number;
    currencyCode: string;
  }>;
  chargesPreview: Array<{
    unitCode: string;
    unitLabel: string | null;
    amountMinor: number;
  }>;
  onRefresh?: () => void;
}

const statusConfig = {
  DRAFT: {
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    label: 'Borrador',
    icon: FileText,
  },
  REVIEWED: {
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
    label: 'Revisado',
    icon: CheckCircle2,
  },
  PUBLISHED: {
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    label: 'Publicado',
    icon: CheckCircle2,
  },
  CANCELED: {
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    label: 'Cancelado',
    icon: AlertCircle,
  },
};

export function LiquidationDraftCard({
  tenantId,
  liquidation,
  expenses,
  chargesPreview,
  onRefresh,
}: LiquidationDraftCardProps) {
  const [showPublishModal, setShowPublishModal] = useState(false);
  const reviewMutation = useReviewLiquidation(tenantId);
  const publishMutation = usePublishLiquidation(tenantId);
  const cancelMutation = useCancelLiquidation(tenantId);

  const config = statusConfig[liquidation.status];
  const StatusIcon = config.icon;

  const handleReview = async () => {
    await reviewMutation.mutateAsync(liquidation.id);
    onRefresh?.();
  };

  const handlePublish = async (dueDate: string) => {
    await publishMutation.mutateAsync({
      liquidationId: liquidation.id,
      dueDate,
    });
    setShowPublishModal(false);
    onRefresh?.();
  };

  const handleCancel = async () => {
    if (!confirm('¿Está seguro de cancelar esta liquidación?')) return;
    try {
      await cancelMutation.mutateAsync(liquidation.id);
      onRefresh?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al cancelar la liquidación';
      alert(msg);
    }
  };

  return (
    <Card className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b pb-3">
        <div className="flex items-center gap-3">
          <StatusIcon className={`w-5 h-5 ${config.color}`} />
          <div>
            <h3 className="font-semibold">Período {liquidation.period}</h3>
            <p className="text-xs text-gray-600">
              {liquidation.unitCount} unidades • {expenses.length} gastos
            </p>
          </div>
        </div>
        <Badge className={`${config.color} ${config.bgColor}`}>
          {config.label}
        </Badge>
      </div>

      {/* Total Amount */}
      <div className="flex items-center justify-between bg-gray-50 p-3 rounded">
        <span className="font-medium">Total Expensas</span>
        <span className="text-lg font-bold">
          {formatCurrency(liquidation.totalAmountMinor, liquidation.baseCurrency)}
        </span>
      </div>

      {/* Expenses Summary */}
      <div className="space-y-2">
        <p className="text-sm font-semibold">Gastos Incluidos ({expenses.length})</p>
        <div className="max-h-32 space-y-1 overflow-y-auto rounded border bg-gray-50 p-2 text-xs">
          {expenses.length > 0 ? (
            expenses.map((exp) => (
              <div key={exp.id} className="flex justify-between">
                <span className="text-gray-600">{exp.categoryName}</span>
                <span className="font-medium">{formatCurrency(exp.amountMinor, exp.currencyCode)}</span>
              </div>
            ))
          ) : (
            <p className="text-gray-500">Sin gastos</p>
          )}
        </div>
      </div>

      {/* Charges Preview */}
      <div className="space-y-2">
        <p className="text-sm font-semibold">Preview de Cargos ({chargesPreview.length})</p>
        <div className="max-h-40 space-y-1 overflow-y-auto rounded border bg-gray-50 p-2 text-xs">
          {chargesPreview.length > 0 ? (
            <>
              {chargesPreview.slice(0, 10).map((charge) => (
                <div key={charge.unitCode} className="flex justify-between">
                  <span>
                    {charge.unitCode}
                    {charge.unitLabel && ` (${charge.unitLabel})`}
                  </span>
                  <span className="font-medium">{formatCurrency(charge.amountMinor, liquidation.baseCurrency)}</span>
                </div>
              ))}
              {chargesPreview.length > 10 && (
                <p className="text-xs text-gray-500 mt-1">
                  +{chargesPreview.length - 10} más...
                </p>
              )}
            </>
          ) : (
            <p className="text-gray-500">Sin cargos</p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 border-t pt-3">
        {liquidation.status === 'DRAFT' && (
          <>
            <Button
              onClick={handleReview}
              disabled={reviewMutation.isPending}
              className="flex items-center gap-1"
            >
              {reviewMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
              Revisar
            </Button>
            <Button
              onClick={handleCancel}
              disabled={cancelMutation.isPending}
              variant="secondary"
              className="flex items-center gap-1"
            >
              {cancelMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
              Cancelar
            </Button>
          </>
        )}

        {liquidation.status === 'REVIEWED' && (
          <>
            <PublishLiquidationModal
              onPublish={handlePublish}
              isLoading={publishMutation.isPending}
              liquidationId={liquidation.id}
            />
            <Button
              onClick={handleCancel}
              disabled={cancelMutation.isPending}
              variant="secondary"
              className="flex items-center gap-1"
            >
              {cancelMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
              Cancelar
            </Button>
          </>
        )}

        {liquidation.status === 'PUBLISHED' && (
          <Button
            onClick={handleCancel}
            disabled={cancelMutation.isPending}
            variant="danger"
            className="flex items-center gap-1"
          >
            {cancelMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
            <Trash2 className="w-3 h-3" />
            Cancelar
          </Button>
        )}

        {liquidation.status === 'CANCELED' && (
          <p className="text-xs text-gray-600">Liquidación cancelada - no hay acciones disponibles</p>
        )}
      </div>
    </Card>
  );
}
