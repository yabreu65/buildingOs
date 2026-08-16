import { UnprocessableEntityException } from '@nestjs/common';
import { IncomeApplicationDestination, MovementScope, Prisma } from '@prisma/client';

/**
 * FIN-06: helpers puros para valuar y distribuir IncomeApplications
 * OFFSET_EXPENSES hacia el building de una Liquidation.
 *
 * Principios:
 * - Sin FX live: se usa únicamente el snapshot congelado del Income (record).
 * - Aritmética EXACTA: todas las distribuciones usan Prisma.Decimal
 *   (mul/div con ROUND_DOWN + largest remainder), nunca Number multiplication
 *   sobre productos que pueden exceder Number.MAX_SAFE_INTEGER.
 * - MovementAllocation decide A QUÉ building pertenece el movimiento;
 *   IncomeApplication decide QUÉ se hace con el dinero.
 * - SUM(building shares de una aplicación) == application.amountMinor.
 * - Fail-closed: un OFFSET elegible sin snapshot funcional convergente
 *   NUNCA se omite silenciosamente → 422.
 */

export const LIQUIDATION_INCOME_OFFSET_CURRENCY_MISMATCH =
  'LIQUIDATION_INCOME_OFFSET_CURRENCY_MISMATCH';
export const LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED =
  'LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED';
export const LIQUIDATION_INCOME_OFFSETS_EXCEED_GROSS =
  'LIQUIDATION_INCOME_OFFSETS_EXCEED_GROSS';
export const LIQUIDATION_INCOME_SOURCE_DRIFT = 'LIQUIDATION_INCOME_SOURCE_DRIFT';

export interface IncomeOffsetApplicationRow {
  readonly id: string;
  readonly incomeId: string;
  readonly destinationType: IncomeApplicationDestination;
  readonly amountMinor: number;
  readonly currencyCode: string;
  readonly policyVersionId: string | null;
  readonly buildingId: string | null;
  readonly period: string;
  readonly scopeType: MovementScope;
  readonly status: 'DRAFT' | 'RECORDED' | 'VOID';
  readonly functionalAmountMinor: number | null;
  readonly functionalCurrencyCode: string | null;
  readonly exchangeRateId: string | null;
  readonly exchangeRateValue: string | null;
  readonly exchangeRateDirection: string | null;
  readonly exchangeRateEffectiveAt: Date | null;
  readonly conversionDate: Date | null;
  readonly receivedDate: Date;
  readonly categoryName?: string | null;
}

export interface BuildingAllocationWeight {
  readonly buildingId: string;
  readonly amountMinor: number;
}

/**
 * Distribuye un total en minor units entre buckets usando weights enteros
 * con largest remainder y aritmética decimal EXACTA (tie-break: buildingId).
 *
 * Garantías: SUM(resultado) === total; enteros; determinístico; sin
 * multiplicación Number que pierda precisión sobre MAX_SAFE_INTEGER.
 */
export function distributeMinorByWeights(
  total: number,
  weights: readonly BuildingAllocationWeight[],
): Array<{ buildingId: string; amountMinor: number }> {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error(`distributeMinorByWeights requires a non-negative safe integer total (${total})`);
  }
  if (weights.length === 0) {
    if (total === 0) return [];
    throw new Error('distributeMinorByWeights requires weights for a positive total');
  }

  const sortedWeights = [...weights]
    .filter((weight) => weight.amountMinor > 0)
    .sort((a, b) => a.buildingId.localeCompare(b.buildingId));

  if (sortedWeights.length === 0) {
    if (total === 0) {
      return weights
        .map((weight) => ({ buildingId: weight.buildingId, amountMinor: 0 }))
        .sort((a, b) => a.buildingId.localeCompare(b.buildingId));
    }
    throw new Error('distributeMinorByWeights requires positive weights for a positive total');
  }

  const totalDecimal = new Prisma.Decimal(total);
  const weightDecimals = sortedWeights.map((weight) => new Prisma.Decimal(weight.amountMinor));
  const totalWeight = weightDecimals.reduce(
    (sum, weight) => sum.add(weight),
    new Prisma.Decimal(0),
  );

  if (totalWeight.isZero()) {
    throw new Error('distributeMinorByWeights requires positive weights for a positive total');
  }

  // Largest remainder con aritmética decimal exacta.
  const raw = sortedWeights.map((weight) => {
    const exact = totalDecimal.mul(weight.amountMinor).div(totalWeight);
    const floor = exact.toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
    return {
      buildingId: weight.buildingId,
      floor: floor.toNumber(),
      fraction: exact.sub(floor),
    };
  });

  let allocated = raw.reduce((sum, item) => sum + item.floor, 0);
  const remainder = total - allocated;

  if (!Number.isSafeInteger(remainder) || remainder < 0) {
    throw new Error('distributeMinorByWeights failed to reconcile (remainder)');
  }

  const winners = [...raw]
    .sort((a, b) => {
      const fractionComparison = b.fraction.comparedTo(a.fraction);
      if (fractionComparison !== 0) return fractionComparison;
      return a.buildingId.localeCompare(b.buildingId);
    })
    .slice(0, remainder);

  for (const winner of winners) {
    winner.floor += 1;
  }

  const finalTotal = raw.reduce((sum, item) => sum + item.floor, 0);
  if (finalTotal !== total) {
    throw new Error(`distributeMinorByWeights failed to reconcile (${finalTotal} !== ${total})`);
  }

  return raw
    .map((item) => ({ buildingId: item.buildingId, amountMinor: item.floor }))
    .sort((a, b) => a.buildingId.localeCompare(b.buildingId));
}

/**
 * Determina la porción de una IncomeApplication OFFSET que corresponde al
 * building de la liquidación.
 *
 * BUILDING: la aplicación completa pertenece al building del Income.
 * TENANT_SHARED / UNIT_GROUP: se distribuye por MovementAllocation weights.
 */
export function resolveIncomeOffsetBuildingShare(params: {
  applicationAmountMinor: number;
  applicationScopeType: MovementScope;
  incomeBuildingId: string | null;
  liquidationBuildingId: string;
  allocationWeights: readonly BuildingAllocationWeight[];
}): number {
  const { applicationAmountMinor, applicationScopeType, incomeBuildingId, liquidationBuildingId, allocationWeights } =
    params;

  if (applicationScopeType === 'BUILDING') {
    return incomeBuildingId === liquidationBuildingId ? applicationAmountMinor : 0;
  }

  if (applicationScopeType === 'TENANT_SHARED' || applicationScopeType === 'UNIT_GROUP') {
    if (allocationWeights.length === 0) {
      // Sin allocation persistida no hay evidencia de pertenencia al building.
      return 0;
    }

    const relevantWeights = allocationWeights.filter(
      (weight) => weight.buildingId === liquidationBuildingId,
    );

    if (relevantWeights.length === 0) {
      return 0;
    }

    const shares = distributeMinorByWeights(applicationAmountMinor, allocationWeights);
    const ownShare = shares.find((share) => share.buildingId === liquidationBuildingId);
    return ownShare?.amountMinor ?? 0;
  }

  // MovementScope desconocido: conservador, sin reducción.
  return 0;
}

/**
 * Deriva el functional amount minor de CADA IncomeApplication
 * proporcionalmente a application.amountMinor (largest remainder EXACTO).
 *
 * Garantía: SUM(applicationFunctionalValues) === incomeFunctionalAmountMinor.
 */
export function deriveApplicationFunctionalValues(params: {
  incomeFunctionalAmountMinor: number;
  applications: ReadonlyArray<{ id: string; amountMinor: number }>;
}): Array<{ applicationId: string; functionalAmountMinor: number }> {
  const { incomeFunctionalAmountMinor, applications } = params;
  if (!Number.isSafeInteger(incomeFunctionalAmountMinor) || incomeFunctionalAmountMinor < 0) {
    throw new Error('deriveApplicationFunctionalValues requires non-negative safe integer');
  }
  if (applications.length === 0) {
    if (incomeFunctionalAmountMinor === 0) return [];
    throw new Error('deriveApplicationFunctionalValues requires applications for a positive total');
  }

  const sorted = [...applications].sort((a, b) => a.id.localeCompare(b.id));
  const totalAmount = sorted.reduce((sum, app) => sum + app.amountMinor, 0);

  if (totalAmount <= 0) {
    throw new Error('deriveApplicationFunctionalValues requires positive application amounts');
  }

  const totalDecimal = new Prisma.Decimal(incomeFunctionalAmountMinor);
  const totalAmountDecimal = new Prisma.Decimal(totalAmount);

  const raw = sorted.map((app) => {
    const exact = totalDecimal.mul(app.amountMinor).div(totalAmountDecimal);
    const floor = exact.toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
    return {
      applicationId: app.id,
      floor: floor.toNumber(),
      fraction: exact.sub(floor),
    };
  });

  let allocated = raw.reduce((sum, item) => sum + item.floor, 0);
  const remainder = incomeFunctionalAmountMinor - allocated;

  if (!Number.isSafeInteger(remainder) || remainder < 0) {
    throw new Error('deriveApplicationFunctionalValues failed to reconcile (remainder)');
  }

  const winners = [...raw]
    .sort((a, b) => {
      const fractionComparison = b.fraction.comparedTo(a.fraction);
      if (fractionComparison !== 0) return fractionComparison;
      return a.applicationId.localeCompare(b.applicationId);
    })
    .slice(0, remainder);

  for (const winner of winners) {
    winner.floor += 1;
  }

  const finalTotal = raw.reduce((sum, item) => sum + item.floor, 0);
  if (finalTotal !== incomeFunctionalAmountMinor) {
    throw new Error(
      `deriveApplicationFunctionalValues failed to reconcile (${finalTotal} !== ${incomeFunctionalAmountMinor})`,
    );
  }

  return raw
    .map((item) => ({ applicationId: item.applicationId, functionalAmountMinor: item.floor }))
    .sort((a, b) => a.applicationId.localeCompare(b.applicationId));
}

/**
 * Fail-closed: valida que el snapshot funcional del Income OFFSET converja a
 * la moneda base de la liquidación. Un OFFSET elegible sin snapshot funcional
 * válido NUNCA se omite silenciosamente.
 */
export function assertFunctionalSnapshotForLiquidation(params: {
  incomeId: string;
  functionalAmountMinor: number | null;
  functionalCurrencyCode: string | null;
  baseCurrency: string;
}): void {
  const { incomeId, functionalAmountMinor, functionalCurrencyCode, baseCurrency } = params;

  if (
    functionalAmountMinor === null ||
    functionalAmountMinor === undefined ||
    functionalAmountMinor <= 0
  ) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED,
      message: `El ingreso ${incomeId} no posee un snapshot funcional válido (${baseCurrency}); no se puede valuar su OFFSET`,
    });
  }

  if (functionalCurrencyCode !== baseCurrency) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED,
      message: `El ingreso ${incomeId} está en ${functionalCurrencyCode ?? 'null'}, ` +
        `se esperaba la moneda funcional (${baseCurrency}); no se puede valuar su OFFSET`,
    });
  }
}

/**
 * Valida el modo de valuación de una IncomeApplication OFFSET respecto a la
 * liquidación y devuelve el monto valorado que reduce el neto distributable.
 *
 * LEGACY_NOMINAL: currencyCode === baseCurrency (si difiere → mismatch).
 * FUNCTIONAL: usa el snapshot funcional congelado del Income (fail-closed).
 */
export function valueIncomeOffsetForLiquidation(params: {
  application: {
    id: string;
    amountMinor: number;
    currencyCode: string;
    functionalAmountMinor: number | null;
    functionalCurrencyCode: string | null;
  };
  valuationMode: 'FUNCTIONAL' | 'LEGACY_NOMINAL';
  baseCurrency: string;
}): number {
  const { application, valuationMode, baseCurrency } = params;

  if (valuationMode === 'LEGACY_NOMINAL') {
    if (application.currencyCode !== baseCurrency) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: LIQUIDATION_INCOME_OFFSET_CURRENCY_MISMATCH,
        message: `La aplicación OFFSET ${application.id} está en ${application.currencyCode}, ` +
          `se esperaba la moneda base de la liquidación (${baseCurrency})`,
      });
    }
    return application.amountMinor;
  }

  if (
    application.functionalAmountMinor === null ||
    application.functionalAmountMinor <= 0 ||
    application.functionalCurrencyCode !== baseCurrency
  ) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED,
      message: `La aplicación OFFSET ${application.id} no converge a la moneda funcional (${baseCurrency})`,
    });
  }

  return application.functionalAmountMinor;
}

export function buildIncomeOffsetExceedsGrossError(params: {
  incomeOffsetAmountMinor: number;
  preIncomeAmountMinor: number;
}): UnprocessableEntityException {
  return new UnprocessableEntityException({
    statusCode: 422,
    error: LIQUIDATION_INCOME_OFFSETS_EXCEED_GROSS,
    message:
      `Los offsets de ingresos (${params.incomeOffsetAmountMinor}) superan el monto ` +
      `pre-ingreso (${params.preIncomeAmountMinor}); no se puede crear una liquidación negativa`,
  });
}

export function buildIncomeSourceDriftError(message: string): UnprocessableEntityException {
  return new UnprocessableEntityException({
    statusCode: 422,
    error: LIQUIDATION_INCOME_SOURCE_DRIFT,
    message,
  });
}
