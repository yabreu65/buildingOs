'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { formatCurrency } from '@/shared/lib/format/money';
import { useToast } from '@/shared/components/ui/Toast';
import Button from '@/shared/components/ui/Button';
import { Liquidation, LiquidationDetail, LiquidationStatus } from '../services/expense-ledger.api';
import {
  useReviewLiquidation,
  useCancelLiquidation,
} from '../hooks/useExpenseLedger';
import { LiquidationPublishModal } from './LiquidationPublishModal';

interface LiquidationCardProps {
  tenantId: string;
  liquidation: Liquidation | LiquidationDetail;
  onRefresh: () => void;
}

const STATUS_LABELS: Record<LiquidationStatus, string> = {
  DRAFT: 'Borrador',
  REVIEWED: 'Revisada',
  PUBLISHED: 'Publicada',
  CANCELED: 'Cancelada',
};

const STATUS_COLORS: Record<LiquidationStatus, string> = {
  DRAFT: 'bg-yellow-100 text-yellow-800',
  REVIEWED: 'bg-blue-100 text-blue-800',
  PUBLISHED: 'bg-green-100 text-green-800',
  CANCELED: 'bg-gray-100 text-gray-500',
};

function isDetail(liq: Liquidation | LiquidationDetail): liq is LiquidationDetail {
  return 'expenses' in liq;
}

export function LiquidationCard({
  tenantId,
  liquidation,
  onRefresh,
}: LiquidationCardProps) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);

  const reviewMutation = useReviewLiquidation(tenantId);
  const cancelMutation = useCancelLiquidation(tenantId);

  const handleReview = async () => {
    try {
      await reviewMutation.mutateAsync(liquidation.id);
      toast('Liquidación marcada como revisada', 'success');
      onRefresh();
    } catch {
      toast('Error al revisar la liquidación', 'error');
    }
  };

  const handleCancel = async () => {
    try {
      await cancelMutation.mutateAsync(liquidation.id);
      toast('Liquidación cancelada', 'success');
      onRefresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al cancelar';
      toast(msg, 'error');
    }
  };

  const totalsEntries = Object.entries(liquidation.totalsByCurrency);

  return (
    <div className="rounded-lg border bg-background shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div>
            <span className="font-semibold">Período {liquidation.period}</span>
            <span
              className={cn(
                'ml-2 inline-block px-2 py-0.5 rounded-full text-xs font-medium',
                STATUS_COLORS[liquidation.status],
              )}
            >
              {STATUS_LABELS[liquidation.status]}
            </span>
          </div>
          <div className="text-sm text-muted-foreground">
            {liquidation.unitCount} unidades
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Totales */}
          <div className="text-right">
            {totalsEntries.map(([cur, amt]) => (
              <div key={cur} className="font-mono text-sm font-medium">
                {formatCurrency(amt, cur)}
              </div>
            ))}
          </div>

          {/* Acciones */}
          <div className="flex gap-1">
            {liquidation.status === 'DRAFT' && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleReview}
                  disabled={reviewMutation.isPending}
                >
                  {reviewMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    'Revisar'
                  )}
                </Button>
                <Button
                  size="sm"
                  onClick={() => setShowPublishModal(true)}
                >
                  Publicar
                </Button>
              </>
            )}

            {liquidation.status === 'REVIEWED' && (
              <Button
                size="sm"
                onClick={() => setShowPublishModal(true)}
              >
                Publicar
              </Button>
            )}

            {(liquidation.status === 'DRAFT' ||
              liquidation.status === 'REVIEWED') && (
              <Button
                size="sm"
                variant="secondary"
                onClick={handleCancel}
                disabled={cancelMutation.isPending}
                className="text-red-600 hover:text-red-700"
              >
                {cancelMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  'Cancelar'
                )}
              </Button>
            )}

            {liquidation.status === 'PUBLISHED' && (
              <Button
                size="sm"
                variant="secondary"
                onClick={handleCancel}
                disabled={cancelMutation.isPending}
                className="text-red-600 hover:text-red-700"
              >
                Cancelar
              </Button>
            )}
          </div>

          {/* Expandir */}
          {isDetail(liquidation) && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="p-1 rounded hover:bg-muted"
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Detail expandible */}
      {expanded && isDetail(liquidation) && (
        <div className="border-t px-4 py-3 space-y-4">
          {/* Gastos */}
          <div>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
              Gastos incluidos
            </h4>
            <div className="space-y-1">
              {liquidation.expenses.map((exp) => (
                <div
                  key={exp.id}
                  className="flex justify-between text-sm text-muted-foreground"
                >
                  <span>
                    {exp.categoryName}
                    {exp.vendorName ? ` (${exp.vendorName})` : ''}
                  </span>
                  <span className="font-mono">
                    {formatCurrency(exp.amountMinor, exp.currencyCode)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Preview por unidad */}
          {liquidation.chargesPreview.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Distribución estimada por unidad
              </h4>
              <div className="grid grid-cols-2 gap-1 text-xs">
                {liquidation.chargesPreview.map((c) => (
                  <div
                    key={c.unitId}
                    className="flex justify-between text-muted-foreground"
                  >
                    <span>
                      {c.unitCode}
                      {c.unitLabel ? ` — ${c.unitLabel}` : ''}
                    </span>
                    <span className="font-mono">
                      {formatCurrency(c.amountMinor, liquidation.baseCurrency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {showPublishModal && (
        <LiquidationPublishModal
          tenantId={tenantId}
          liquidationId={liquidation.id}
          period={liquidation.period}
          totalAmountMinor={liquidation.totalAmountMinor}
          baseCurrency={liquidation.baseCurrency}
          unitCount={liquidation.unitCount}
          onClose={() => setShowPublishModal(false)}
          onPublished={() => {
            setShowPublishModal(false);
            onRefresh();
          }}
        />
      )}
    </div>
  );
}
