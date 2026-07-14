'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { formatCurrency } from '@/shared/lib/format/money';
import { useToast } from '@/shared/components/ui/Toast';
import Button from '@/shared/components/ui/Button';
import { Liquidation, LiquidationDetail, LiquidationStatus } from '../services/expense-ledger.api';
import {
  useLiquidationDetail,
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

  const detailQuery = useLiquidationDetail(tenantId, liquidation.id, expanded);
  const reviewMutation = useReviewLiquidation(tenantId);
  const cancelMutation = useCancelLiquidation(tenantId);
  const resolvedDetail = detailQuery.data ?? (isDetail(liquidation) ? liquidation : null);
  const detailSectionId = `liquidation-detail-${liquidation.id}`;
  const detailIsLoading = expanded && !resolvedDetail && detailQuery.isLoading;
  const detailIsError = expanded && !resolvedDetail && detailQuery.isError;
  const detailErrorMessage =
    detailQuery.error instanceof Error
      ? detailQuery.error.message
      : 'No pudimos cargar el detalle de la liquidación.';
  const chargesPreview = resolvedDetail?.chargesPreview ?? [];
  const expenses = resolvedDetail?.expenses ?? [];
  const totalDistributedMinor = chargesPreview.reduce(
    (sum, charge) => sum + charge.amountMinor,
    0,
  );
  const hasDistributionMismatch =
    resolvedDetail !== null &&
    totalDistributedMinor !== liquidation.totalAmountMinor;
  const detailTitle =
    liquidation.status === 'PUBLISHED'
      ? 'Cargos generados por unidad'
      : 'Distribución estimada por unidad';
  const terminalMessage =
    liquidation.status === 'PUBLISHED'
      ? 'Liquidación publicada — no hay acciones disponibles'
      : liquidation.status === 'CANCELED'
        ? 'Liquidación cancelada — no hay acciones disponibles'
        : null;

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
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap justify-end gap-1">
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
                </>
              )}

              {liquidation.status === 'REVIEWED' && (
                <>
                  <Button
                    size="sm"
                    onClick={() => setShowPublishModal(true)}
                  >
                    Publicar
                  </Button>
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
                </>
              )}

              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
                aria-controls={detailSectionId}
              >
                {expanded ? 'Ocultar detalle' : 'Ver detalle'}
                {expanded ? (
                  <ChevronUp className="ml-1 h-4 w-4" />
                ) : (
                  <ChevronDown className="ml-1 h-4 w-4" />
                )}
              </Button>
            </div>

            {terminalMessage ? (
              <p className="text-xs text-muted-foreground text-right">
                {terminalMessage}
              </p>
            ) : null}
          </div>

        </div>
      </div>

      {expanded && (
        <div
          id={detailSectionId}
          className="border-t px-4 py-3 space-y-4"
          aria-live="polite"
        >
          {detailIsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Cargando detalle de la liquidación…</span>
            </div>
          ) : detailIsError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <p className="font-medium">No pudimos cargar el detalle de la liquidación.</p>
              <p className="mt-1">{detailErrorMessage}</p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void detailQuery.refetch()}
                className="mt-3"
              >
                Reintentar
              </Button>
            </div>
          ) : resolvedDetail ? (
            <>
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                  Gastos incluidos
                </h4>
                {expenses.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No hay datos históricos disponibles.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {expenses.map((exp) => (
                      <li
                        key={exp.id}
                        className="flex flex-col gap-1 rounded-md border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {exp.categoryName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {exp.vendorName ? `${exp.vendorName} · ` : ''}
                            {formatCurrency(exp.amountMinor, exp.currencyCode)}
                          </p>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {formatCurrency(exp.amountMinor, exp.currencyCode)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex flex-col gap-1">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                    {detailTitle}
                  </h4>
                  {liquidation.status === 'PUBLISHED' ? (
                    <p className="text-xs text-muted-foreground">
                      Estos importes son cargos asignados a las unidades. No representan pagos recibidos.
                    </p>
                  ) : null}
                </div>

                {chargesPreview.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No hay cargos asociados a esta liquidación.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {chargesPreview.map((charge) => (
                      <li
                        key={charge.unitId}
                        className="flex flex-col gap-1 rounded-md border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            Unidad {charge.unitCode}
                            {charge.unitLabel ? ` — ${charge.unitLabel}` : ''}
                          </p>
                        </div>
                        <div className="text-sm font-mono text-foreground">
                          {formatCurrency(charge.amountMinor, liquidation.baseCurrency)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>Unidades incluidas: {chargesPreview.length}</p>
                  <p>
                    Total distribuido:{' '}
                    {formatCurrency(totalDistributedMinor, liquidation.baseCurrency)}
                  </p>
                </div>

                {hasDistributionMismatch ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    El total distribuido entre las unidades no coincide con el total de la liquidación.
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
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
