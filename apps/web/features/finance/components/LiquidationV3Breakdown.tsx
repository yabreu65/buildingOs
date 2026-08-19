'use client';

import { formatCurrency } from '@/shared/lib/format/money';
import { incomeApplicationProvenance } from '../utils/income-application-provenance';
import {
  liquidationHasV3Summary,
  liquidationIsZeroNet,
} from '../utils/liquidation-v3';
import type {
  IncomeOffsetSnapshotItem,
  Liquidation,
  LiquidationDetail,
} from '../contracts';

interface LiquidationV3BreakdownProps {
  liquidation: Liquidation | LiquidationDetail;
}

const PROVENANCE_LABELS = {
  MANUAL: 'Manual',
  POLICY: 'Política',
  LEGACY: 'Legacy',
  INVALID: 'Desconocido',
} as const;

function offsetProvenanceLabel(item: IncomeOffsetSnapshotItem): string {
  const provenance = incomeApplicationProvenance({
    policyVersionId: item.policyVersionId,
    legacyDestination: item.legacyDestination,
  });
  return PROVENANCE_LABELS[provenance.origin];
}

/**
 * FIN-07C: desglose V3 de una liquidación usando los campos persistidos
 * (gross / adjustments / pre-income / offset / net). No recalcula contra
 * datos live: es información financiera histórica congelada.
 */
export function LiquidationV3Breakdown({
  liquidation,
}: LiquidationV3BreakdownProps) {
  if (!liquidationHasV3Summary(liquidation)) {
    return (
      <div
        className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground"
        data-testid="liquidation-historical"
      >
        Liquidación histórica — formato anterior. No se muestran desgloses V3 de
        ingresos aplicados.
      </div>
    );
  }

  const gross = liquidation.grossExpenseAmountMinor ?? 0;
  const adjustment = liquidation.adjustmentAmountMinor ?? 0;
  const preIncome = liquidation.preIncomeAmountMinor ?? 0;
  const offset = liquidation.incomeOffsetAmountMinor ?? 0;
  const net = liquidation.netDistributableAmountMinor ?? 0;
  const baseCurrency = liquidation.baseCurrency;
  const offsets = liquidation.incomeOffsetSnapshot ?? [];
  const offsetsByCurrency = liquidation.incomeOffsetsByCurrency ?? null;
  const zeroNet = liquidationIsZeroNet(liquidation);

  return (
    <div
      className="space-y-3 rounded-md border bg-muted/20 p-3"
      data-testid="liquidation-v3-breakdown"
    >
      <h4 className="text-xs font-semibold uppercase text-muted-foreground">
        Desglose de la liquidación
      </h4>

      <dl className="space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Gastos brutos</dt>
          <dd className="font-mono font-medium">
            {formatCurrency(gross, baseCurrency)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Ajustes</dt>
          <dd className="font-mono font-medium">
            {formatCurrency(adjustment, baseCurrency)}
          </dd>
        </div>
        <div className="flex justify-between border-t pt-1">
          <dt className="font-medium">Subtotal</dt>
          <dd className="font-mono font-medium">
            {formatCurrency(preIncome, baseCurrency)}
          </dd>
        </div>
      </dl>

      <div className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">
          Ingresos aplicados
        </p>
        {offsets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin desglose de ingresos disponible.
          </p>
        ) : (
          <ul className="space-y-1">
            {offsets.map((item) => {
              const hasSharedScope = item.applicationAmountMinor !== item.buildingAmountMinor;
              return (
                <li
                  key={item.incomeApplicationId}
                  data-testid="liquidation-offset-row"
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <div className="min-w-0">
                    <span className="font-medium">
                      {item.categoryName ?? 'Ingreso'}
                    </span>
                    <span className="ml-2 inline-block rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {offsetProvenanceLabel(item)}
                    </span>
                    {hasSharedScope ? (
                      <span className="block text-xs text-muted-foreground">
                        Aplicación total:{' '}
                        {formatCurrency(item.applicationAmountMinor, item.currencyCode)}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-right font-mono">
                    {formatCurrency(item.buildingAmountMinor, item.currencyCode)}
                    {item.currencyCode !== baseCurrency ? (
                      <span className="text-muted-foreground">
                        {' '}
                        → {formatCurrency(item.valuedAmountMinor, baseCurrency)}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {offsetsByCurrency !== null && Object.keys(offsetsByCurrency).length > 0 ? (
          <div className="mt-2 space-y-0.5 border-t pt-2 text-xs text-muted-foreground">
            <p className="font-medium">Por moneda</p>
            {Object.entries(offsetsByCurrency).map(([currency, amount]) => (
              <div key={currency} className="flex justify-between">
                <span>{currency}</span>
                <span className="font-mono">
                  {formatCurrency(amount, currency)}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <dl className="space-y-1 border-t pt-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Ingresos aplicados</dt>
          <dd className="font-mono font-medium">
            −{formatCurrency(offset, baseCurrency)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="font-semibold">Neto a distribuir</dt>
          <dd className="font-mono font-semibold">
            {formatCurrency(net, baseCurrency)}
          </dd>
        </div>
      </dl>

      {zeroNet ? (
        <p
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
          data-testid="liquidation-zero-net"
        >
          El ingreso del edificio cubrió por completo el monto distribuible del
          período. No quedan gastos a distribuir entre las unidades.
        </p>
      ) : null}
    </div>
  );
}
