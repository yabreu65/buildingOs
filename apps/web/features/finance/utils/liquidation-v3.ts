import type { Liquidation } from '../contracts';

/**
 * FIN-07C: helpers para distinguir liquidaciones V3 de históricas V1/V2 y
 * detectar el caso zero-net. No recalcula nada: usa los campos persistidos.
 */

type V3SummaryFields = Pick<
  Liquidation,
  | 'grossExpenseAmountMinor'
  | 'adjustmentAmountMinor'
  | 'preIncomeAmountMinor'
  | 'incomeOffsetAmountMinor'
  | 'netDistributableAmountMinor'
>;

/**
 * V3 real: los cinco campos FIN-06 están presentes (no null/undefined).
 * Una liquidación histórica V1/V2 tiene estos campos null.
 */
export function liquidationHasV3Summary(liquidation: V3SummaryFields): boolean {
  return (
    liquidation.grossExpenseAmountMinor != null &&
    liquidation.adjustmentAmountMinor != null &&
    liquidation.preIncomeAmountMinor != null &&
    liquidation.incomeOffsetAmountMinor != null &&
    liquidation.netDistributableAmountMinor != null
  );
}

/**
 * Zero-net: el ingreso elegible cubrió por completo el distribuible del período.
 * No es un estado roto; se muestra como liquidación válida con neto 0.
 */
export function liquidationIsZeroNet(liquidation: V3SummaryFields): boolean {
  return (
    liquidation.preIncomeAmountMinor != null &&
    liquidation.incomeOffsetAmountMinor != null &&
    liquidation.preIncomeAmountMinor === liquidation.incomeOffsetAmountMinor
  );
}
