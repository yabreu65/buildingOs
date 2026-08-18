'use client';

import { useMemo, useState } from 'react';
import { Loader2, AlertTriangle, ArrowRightLeft } from 'lucide-react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { formatCurrency } from '@/shared/lib/format/money';
import { useFunds } from '../hooks/useFunds';
import {
  useApplyLegacyIncomeBackfill,
  useLegacyIncomeBackfillPreview,
} from '../hooks/useLegacyIncomeBackfill';
import type {
  Fund,
  LegacyBackfillApplyItem,
  LegacyBackfillApplyResultItem,
  LegacyBackfillClassification,
  LegacyBackfillPreviewItem,
} from '../contracts';

interface LegacyBackfillPanelProps {
  tenantId: string;
}

const MAX_BATCH = 100;

const CLASSIFICATION_LABELS: Record<LegacyBackfillClassification, string> = {
  AUTO_MAPPABLE_OFFSET: 'Puede migrarse a Aplicar a gastos',
  REQUIRES_RESERVE_FUND: 'Seleccione un Fondo de Reserva',
  REQUIRES_SPECIAL_FUND: 'Seleccione un Fondo Especial',
  ALREADY_HAS_PLAN: 'Ya usa el modelo moderno; no se modificará',
  NOT_RECORDED: 'Ingreso no registrado; no se puede migrar',
  LIQUIDATION_CONFLICT:
    'Existe una liquidación histórica que impide migrarlo automáticamente',
};

const RESULT_STATUS_LABELS: Record<string, string> = {
  MIGRATED: 'Migrados',
  ALREADY_MIGRATED: 'Ya estaban migrados',
  ALREADY_HAS_PLAN: 'Ya usan el modelo moderno',
  REQUIRES_FUND: 'Requieren fondo',
  INVALID_FUND: 'Fondo no válido',
  LIQUIDATION_CONFLICT: 'Bloqueados por liquidación histórica',
  NOT_RECORDED: 'No registrados',
  NOT_FOUND: 'No encontrados',
  INVALID_INCOME: 'Ingresos no válidos',
};

function isActionable(classification: LegacyBackfillClassification): boolean {
  return (
    classification === 'AUTO_MAPPABLE_OFFSET' ||
    classification === 'REQUIRES_RESERVE_FUND' ||
    classification === 'REQUIRES_SPECIAL_FUND'
  );
}

function requiredFundType(
  classification: LegacyBackfillClassification,
): 'RESERVE' | 'SPECIAL' | null {
  if (classification === 'REQUIRES_RESERVE_FUND') return 'RESERVE';
  if (classification === 'REQUIRES_SPECIAL_FUND') return 'SPECIAL';
  return null;
}

function fundLabel(fund: Fund): string {
  return `${fund.name} (${fund.type})`;
}

function summarizeResults(results: LegacyBackfillApplyResultItem[]): string {
  const counts = new Map<string, number>();
  for (const result of results) {
    counts.set(result.status, (counts.get(result.status) ?? 0) + 1);
  }
  const parts = Array.from(counts.entries()).map(
    ([status, count]) => `${count} ${RESULT_STATUS_LABELS[status] ?? status.toLowerCase()}`,
  );
  return parts.join(', ');
}

/**
 * FIN-07C: herramienta de migración (administración) de ingresos legacy al
 * modelo moderno de IncomeApplication. No es el flujo diario de asignación;
 * es una sección de mantenimiento.
 *
 * El backend sigue siendo la autoridad (RBAC TENANT_OWNER/TENANT_ADMIN,
 * tope de lote, validación de fondos). Acá solo se controla la selección.
 */
export function LegacyBackfillPanel({ tenantId }: LegacyBackfillPanelProps) {
  const [fundByIncome, setFundByIncome] = useState<Record<string, string>>({});
  const [lastResult, setLastResult] = useState<LegacyBackfillApplyResultItem[] | null>(null);

  const previewQuery = useLegacyIncomeBackfillPreview(tenantId, {});
  const { data: funds = [] } = useFunds(tenantId, { status: 'ACTIVE' });
  const applyMutation = useApplyLegacyIncomeBackfill(tenantId);

  const reserveFunds = useMemo(
    () => funds.filter((fund) => fund.type === 'RESERVE' && fund.status === 'ACTIVE'),
    [funds],
  );
  const specialFunds = useMemo(
    () => funds.filter((fund) => fund.type === 'SPECIAL' && fund.status === 'ACTIVE'),
    [funds],
  );

  const items: LegacyBackfillPreviewItem[] = previewQuery.data ?? [];

  const selectableItems = items.filter((item) => isActionable(item.classification));
  const selectedIds = Object.keys(fundByIncome);

  const applyItems: LegacyBackfillApplyItem[] = selectableItems
    .filter((item) => selectedIds.includes(item.incomeId))
    .map((item) => {
      const fundId =
        requiredFundType(item.classification) !== null
          ? fundByIncome[item.incomeId]
          : null;
      return { incomeId: item.incomeId, fundId: fundId ?? null };
    });

  const missingFund = selectableItems.some(
    (item) =>
      selectedIds.includes(item.incomeId) &&
      requiredFundType(item.classification) !== null &&
      !fundByIncome[item.incomeId],
  );

  const canApply =
    applyItems.length > 0 &&
    applyItems.length <= MAX_BATCH &&
    !missingFund &&
    !applyMutation.isPending;

  const toggle = (item: LegacyBackfillPreviewItem) => {
    const alreadySelected = item.incomeId in fundByIncome;
    setFundByIncome((prev) => {
      const next = { ...prev };
      if (alreadySelected) {
        delete next[item.incomeId];
      } else {
        next[item.incomeId] = '';
      }
      return next;
    });
    setLastResult(null);
  };

  const handleApply = async () => {
    setLastResult(null);
    try {
      const results = await applyMutation.mutateAsync(applyItems);
      setLastResult(results);
      setFundByIncome({});
    } catch {
      // Mutation error is surfaced via applyMutation.error below.
    }
  };

  if (previewQuery.isPending) {
    return (
      <Card className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Analizando ingresos históricos…
      </Card>
    );
  }

  if (previewQuery.isError) {
    return (
      <Card className="p-6 text-sm text-red-700" role="alert">
        No pudimos analizar los ingresos históricos. Intentá nuevamente.
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        No hay ingresos históricos pendientes de migración.
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <p>
          Herramienta de migración de ingresos históricos al modelo moderno de
          aplicaciones. Solo administradores con alcance de inquilino pueden
          ejecutarla.
        </p>
      </div>

      <ul className="space-y-2">
        {items.map((item) => {
          const actionable = isActionable(item.classification);
          const fundType = requiredFundType(item.classification);
          const compatibleFunds = fundType === 'RESERVE' ? reserveFunds : specialFunds;
          const selected = item.incomeId in fundByIncome;
          const noCompatibleFund = fundType !== null && compatibleFunds.length === 0;

          return (
            <li
              key={item.incomeId}
              className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {formatCurrency(item.amountMinor, item.currencyCode)} · {item.period}
                </p>
                <p className="text-xs text-muted-foreground">
                  {CLASSIFICATION_LABELS[item.classification]}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {fundType !== null && selected ? (
                  noCompatibleFund ? (
                    <p className="text-xs text-amber-700">
                      {fundType === 'RESERVE'
                        ? 'No hay un Fondo de Reserva activo. Cree uno antes de migrar este ingreso.'
                        : 'No hay un Fondo Especial activo. Cree uno antes de migrar este ingreso.'}
                    </p>
                  ) : (
                    <select
                      aria-label={
                        fundType === 'RESERVE'
                          ? 'Fondo de Reserva'
                          : 'Fondo Especial'
                      }
                      value={fundByIncome[item.incomeId] ?? ''}
                      onChange={(event) =>
                        setFundByIncome((prev) => ({
                          ...prev,
                          [item.incomeId]: event.target.value,
                        }))
                      }
                      className="rounded border p-1 text-sm"
                    >
                      <option value="">
                        {fundType === 'RESERVE'
                          ? 'Seleccionar fondo de reserva'
                          : 'Seleccionar fondo especial'}
                      </option>
                      {compatibleFunds.map((fund) => (
                        <option key={fund.id} value={fund.id}>
                          {fundLabel(fund)}
                        </option>
                      ))}
                    </select>
                  )
                ) : null}

                {actionable ? (
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggle(item)}
                      disabled={applyMutation.isPending}
                      aria-label={`Seleccionar ingreso ${item.period} ${formatCurrency(item.amountMinor, item.currencyCode)}`}
                    />
                    Migrar
                  </label>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {applyMutation.error ? (
        <p className="text-sm text-red-700" role="alert">
          No pudimos completar la migración. Revisá la selección e intentá de nuevo.
        </p>
      ) : null}

      {lastResult ? (
        <div
          className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
          role="status"
        >
          <p className="font-medium">
            {lastResult.length} ingresos procesados
          </p>
          <p className="mt-1">{summarizeResults(lastResult)}</p>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <p className="text-xs text-muted-foreground">
          {applyItems.length} seleccionados · máx. {MAX_BATCH} por lote
        </p>
        <Button
          type="button"
          onClick={handleApply}
          disabled={!canApply}
          className="gap-2"
        >
          {applyMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowRightLeft className="h-4 w-4" />
          )}
          {applyMutation.isPending ? 'Migrando…' : 'Aplicar migración'}
        </Button>
      </div>
    </Card>
  );
}
