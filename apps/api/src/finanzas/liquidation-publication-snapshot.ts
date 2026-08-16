import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface PublishedExpenseSnapshot {
  expenseId: string;
  categoryName: string;
  vendorName: string | null;
  amountMinor: number;
  currencyCode: string;
  invoiceDate: string;
  description: string | null;
  type: 'EXPENSE' | 'ADJUSTMENT';
  sourcePeriod?: string;
  functionalAmountMinor?: number | null;
  functionalCurrencyCode?: string | null;
  exchangeRateId?: string | null;
  exchangeRateValue?: string | null;
  exchangeRateDirection?: string | null;
  exchangeRateEffectiveAt?: string | null;
  conversionDate?: string | null;
}

export interface PublishedAllocationSnapshot {
  unitId: string;
  unitCode: string;
  unitLabel: string | null;
  amountMinor: number;
}

export interface LiquidationPublicationSnapshotV1 {
  version: 1;
  liquidationId: string;
  tenantId: string;
  buildingId: string;
  period: string;
  baseCurrency: string;
  totalAmountMinor: number;
  totalsByCurrency: Record<string, number>;
  expenses: readonly PublishedExpenseSnapshot[];
  allocations: readonly PublishedAllocationSnapshot[];
  dueDate: string;
  publishedAt: string;
}

export interface LiquidationPublicationSnapshotV2 {
  version: 2;
  valuationMode: 'FUNCTIONAL' | 'LEGACY_NOMINAL';
  liquidationId: string;
  tenantId: string;
  buildingId: string;
  period: string;
  baseCurrency: string;
  totalAmountMinor: number;
  totalsByCurrency: Record<string, number>;
  expenses: readonly PublishedExpenseSnapshot[];
  allocations: readonly PublishedAllocationSnapshot[];
  dueDate: string;
  publishedAt: string;
}

export interface PublishedIncomeOffsetSnapshot {
  incomeId: string;
  incomeApplicationId: string;
  categoryId: string;
  categoryName: string | null;
  policyVersionId: string | null;
  legacyDestination: string | null; // FIN-04: provenance legacy (null = manual/policy)
  scopeType: string;
  currencyCode: string;
  applicationAmountMinor: number;
  buildingAmountMinor: number;
  valuedAmountMinor: number;
  functionalCurrencyCode: string | null;
  exchangeRateId: string | null;
  exchangeRateValue: string | null;
  exchangeRateDirection: string | null;
  exchangeRateEffectiveAt: string | null;
  conversionDate: string | null;
  receivedDate: string;
  period: string;
}

export interface LiquidationPublicationSnapshotV3 {
  version: 3;
  valuationMode: 'FUNCTIONAL' | 'LEGACY_NOMINAL';
  liquidationId: string;
  tenantId: string;
  buildingId: string;
  period: string;
  baseCurrency: string;
  totalAmountMinor: number;
  totalsByCurrency: Record<string, number>;
  grossExpenseAmountMinor: number;
  adjustmentAmountMinor: number;
  preIncomeAmountMinor: number;
  incomeOffsetAmountMinor: number;
  netDistributableAmountMinor: number;
  incomeOffsetsByCurrency: Record<string, number>;
  expenses: readonly PublishedExpenseSnapshot[];
  incomeOffsets: readonly PublishedIncomeOffsetSnapshot[];
  allocations: readonly PublishedAllocationSnapshot[];
  dueDate: string;
  publishedAt: string;
}

export type LiquidationPublicationSnapshot =
  | LiquidationPublicationSnapshotV1
  | LiquidationPublicationSnapshotV2
  | LiquidationPublicationSnapshotV3;

export interface BuildLiquidationPublicationSnapshotInput {
  liquidationId: string;
  tenantId: string;
  buildingId: string;
  period: string;
  baseCurrency: string;
  totalAmountMinor: number;
  totalsByCurrency: Record<string, number>;
  expenses: readonly PublishedExpenseSnapshot[];
  allocations: readonly PublishedAllocationSnapshot[];
  dueDate: Date;
  publishedAt: Date;
  valuationMode: 'FUNCTIONAL' | 'LEGACY_NOMINAL';
}

export interface LiquidationDistributionUnit {
  id: string;
  code: string;
  label: string | null;
  areaM2: number;
}

export interface LiquidationDistributionAllocation {
  unitId: string;
  unitCode: string;
  unitLabel: string | null;
  areaM2: number;
  amountMinor: number;
}

export function assertLiquidationMovementCurrency(
  movements: ReadonlyArray<{
    currencyCode: string;
    functionalAmountMinor?: number | null;
    functionalCurrencyCode?: string | null;
  }>,
  baseCurrency: string,
  valuationMode: 'FUNCTIONAL' | 'LEGACY_NOMINAL' = 'LEGACY_NOMINAL',
): void {
  if (valuationMode === 'FUNCTIONAL') {
    for (const movement of movements) {
      if (movement.functionalAmountMinor === null || movement.functionalAmountMinor === undefined) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: 'LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED',
          message:
            'La liquidación FUNCTIONAL incluye un movimiento sin snapshot funcional',
        });
      }
      if (
        movement.functionalCurrencyCode !== baseCurrency
      ) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: 'LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED',
          message: `El movimiento en ${movement.currencyCode} no converge a la moneda base (${baseCurrency})`,
        });
      }
    }
    return;
  }

  const currencies = new Set(movements.map((movement) => movement.currencyCode));

  if (currencies.size > 1) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'MIXED_CURRENCY_LIQUIDATION_NOT_SUPPORTED',
      message: 'No se puede generar una liquidación con movimientos en distintas monedas.',
    });
  }

  const [movementCurrency] = currencies;
  if (movementCurrency !== undefined && movementCurrency !== baseCurrency) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'LIQUIDATION_BASE_CURRENCY_MISMATCH',
      message: `La moneda de los movimientos (${movementCurrency}) no coincide con la moneda base de la liquidación (${baseCurrency}).`,
    });
  }
}

export function buildLiquidationPublicationSnapshot(
  input: BuildLiquidationPublicationSnapshotInput,
): Prisma.InputJsonObject {
  assertSafeIntegerNonNegative(input.totalAmountMinor, 'totalAmountMinor');
  assertNonEmpty(input.liquidationId, 'liquidationId');
  assertNonEmpty(input.tenantId, 'tenantId');
  assertNonEmpty(input.buildingId, 'buildingId');
  assertNonEmpty(input.period, 'period');
  assertNonEmpty(input.baseCurrency, 'baseCurrency');
  assertIsoDate(input.dueDate, 'dueDate');
  assertIsoDate(input.publishedAt, 'publishedAt');

  const totalsByCurrency = normalizeTotalsByCurrency(input.totalsByCurrency);
  const expenses = input.expenses.map(normalizeExpenseSnapshot);
  const allocations = input.allocations.map(normalizeAllocationSnapshot);
  const expenseTotalsByCurrency = sumByCurrency(expenses);
  const allocationTotal = allocations.reduce(
    (sum, allocation) =>
      safeAddMinor(sum, allocation.amountMinor, 'allocations.totalAmountMinor'),
    0,
  );
  const valuedTotal =
    input.valuationMode === 'FUNCTIONAL'
      ? sumFunctionalAmount(expenses, input.valuationMode)
      : expenseTotalsByCurrency[input.baseCurrency];

  if (valuedTotal === undefined) {
    throw new BadRequestException(
      'Liquidation publication snapshot must include the base currency total',
    );
  }

  if (valuedTotal !== input.totalAmountMinor) {
    throw new BadRequestException(
      'Liquidation publication snapshot totals must match the liquidation total',
    );
  }

  if (allocationTotal !== input.totalAmountMinor) {
    throw new BadRequestException(
      'Liquidation publication snapshot allocations must match the liquidation total',
    );
  }

  assertCurrencyTotalsMatch(totalsByCurrency, expenseTotalsByCurrency);

  return createJsonObject({
    version: 2,
    valuationMode: input.valuationMode,
    liquidationId: input.liquidationId,
    tenantId: input.tenantId,
    buildingId: input.buildingId,
    period: input.period,
    baseCurrency: input.baseCurrency,
    totalAmountMinor: input.totalAmountMinor,
    totalsByCurrency,
    expenses: createJsonArray(expenses.map(toExpenseJsonObject)),
    allocations: createJsonArray(allocations.map(toAllocationJsonObject)),
    dueDate: input.dueDate.toISOString(),
    publishedAt: input.publishedAt.toISOString(),
  });
}

export interface BuildLiquidationPublicationSnapshotV3Input {
  liquidationId: string;
  tenantId: string;
  buildingId: string;
  period: string;
  baseCurrency: string;
  totalAmountMinor: number;
  totalsByCurrency: Record<string, number>;
  grossExpenseAmountMinor: number;
  adjustmentAmountMinor: number;
  preIncomeAmountMinor: number;
  incomeOffsetAmountMinor: number;
  netDistributableAmountMinor: number;
  incomeOffsetsByCurrency: Record<string, number>;
  expenses: readonly PublishedExpenseSnapshot[];
  incomeOffsets: readonly PublishedIncomeOffsetSnapshot[];
  allocations: readonly PublishedAllocationSnapshot[];
  dueDate: Date;
  publishedAt: Date;
  valuationMode: 'FUNCTIONAL' | 'LEGACY_NOMINAL';
}

/**
 * FIN-06 snapshot V3: incluye income offsets congelados y el desglose
 * gross + adjustments - offsets = net distributable.
 */
export function buildLiquidationPublicationSnapshotV3(
  input: BuildLiquidationPublicationSnapshotV3Input,
): Prisma.InputJsonObject {
  assertSafeIntegerNonNegative(input.totalAmountMinor, 'totalAmountMinor');
  assertSafeIntegerNonNegative(input.grossExpenseAmountMinor, 'grossExpenseAmountMinor');
  assertSafeIntegerNonNegative(input.incomeOffsetAmountMinor, 'incomeOffsetAmountMinor');
  assertSafeIntegerNonNegative(input.netDistributableAmountMinor, 'netDistributableAmountMinor');
  assertNonEmpty(input.liquidationId, 'liquidationId');
  assertNonEmpty(input.tenantId, 'tenantId');
  assertNonEmpty(input.buildingId, 'buildingId');
  assertNonEmpty(input.period, 'period');
  assertNonEmpty(input.baseCurrency, 'baseCurrency');
  assertIsoDate(input.dueDate, 'dueDate');
  assertIsoDate(input.publishedAt, 'publishedAt');

  const totalsByCurrency = normalizeTotalsByCurrency(input.totalsByCurrency);
  const expenses = input.expenses.map(normalizeExpenseSnapshot);
  const allocations = input.allocations.map(normalizeAllocationSnapshot);
  const incomeOffsets = input.incomeOffsets.map(normalizeIncomeOffsetSnapshot);
  const expenseTotalsByCurrency = sumByCurrency(expenses);
  const allocationTotal = allocations.reduce(
    (sum, allocation) =>
      safeAddMinor(sum, allocation.amountMinor, 'allocations.totalAmountMinor'),
    0,
  );
  const valuedTotal =
    input.valuationMode === 'FUNCTIONAL'
      ? sumFunctionalAmount(expenses, input.valuationMode)
      : expenseTotalsByCurrency[input.baseCurrency];

  if (valuedTotal === undefined) {
    throw new BadRequestException(
      'Liquidation publication snapshot must include the base currency total',
    );
  }

  const preIncomeAmountMinor = input.grossExpenseAmountMinor + input.adjustmentAmountMinor;
  const netDistributable =
    preIncomeAmountMinor - input.incomeOffsetAmountMinor;

  if (preIncomeAmountMinor !== input.preIncomeAmountMinor) {
    throw new BadRequestException(
      'Liquidation publication snapshot pre-income total is inconsistent',
    );
  }

  if (netDistributable !== input.netDistributableAmountMinor) {
    throw new BadRequestException(
      'Liquidation publication snapshot net distributable is inconsistent',
    );
  }

  if (netDistributable !== input.totalAmountMinor) {
    throw new BadRequestException(
      'Liquidation publication snapshot total must equal net distributable',
    );
  }

  if (valuedTotal !== preIncomeAmountMinor) {
    throw new BadRequestException(
      'Liquidation publication snapshot expense sources must match pre-income total',
    );
  }

  if (allocationTotal !== input.totalAmountMinor) {
    throw new BadRequestException(
      'Liquidation publication snapshot allocations must match the liquidation total',
    );
  }

  const incomeOffsetValuedTotal = incomeOffsets.reduce(
    (sum, offset) =>
      safeAddMinor(sum, offset.valuedAmountMinor, 'incomeOffsets.valuedAmountMinor'),
    0,
  );

  if (incomeOffsetValuedTotal !== input.incomeOffsetAmountMinor) {
    throw new BadRequestException(
      'Liquidation publication snapshot income offsets must match the offset total',
    );
  }

  // FIN-06R: incomeOffsetsByCurrency debe reconciliar exactamente a
  // { baseCurrency: incomeOffsetAmountMinor } cuando offset > 0.
  const incomeOffsetsByCurrency = normalizeTotalsByCurrency(input.incomeOffsetsByCurrency);
  if (input.incomeOffsetAmountMinor > 0) {
    const expected = { [input.baseCurrency]: input.incomeOffsetAmountMinor };
    const isExact =
      Object.keys(incomeOffsetsByCurrency).length === 1 &&
      incomeOffsetsByCurrency[input.baseCurrency] === expected[input.baseCurrency];
    if (!isExact) {
      throw new BadRequestException(
        'Liquidation publication snapshot incomeOffsetsByCurrency must match the offset total in base currency',
      );
    }
  } else if (Object.keys(incomeOffsetsByCurrency).length > 0) {
    throw new BadRequestException(
      'Liquidation publication snapshot incomeOffsetsByCurrency must be empty for zero offsets',
    );
  }

  assertCurrencyTotalsMatch(totalsByCurrency, expenseTotalsByCurrency);

  return createJsonObject({
    version: 3,
    valuationMode: input.valuationMode,
    liquidationId: input.liquidationId,
    tenantId: input.tenantId,
    buildingId: input.buildingId,
    period: input.period,
    baseCurrency: input.baseCurrency,
    totalAmountMinor: input.totalAmountMinor,
    totalsByCurrency,
    grossExpenseAmountMinor: input.grossExpenseAmountMinor,
    adjustmentAmountMinor: input.adjustmentAmountMinor,
    preIncomeAmountMinor,
    incomeOffsetAmountMinor: input.incomeOffsetAmountMinor,
    netDistributableAmountMinor: input.netDistributableAmountMinor,
    incomeOffsetsByCurrency,
    expenses: createJsonArray(expenses.map(toExpenseJsonObject)),
    incomeOffsets: createJsonArray(incomeOffsets.map(toIncomeOffsetJsonObject)),
    allocations: createJsonArray(allocations.map(toAllocationJsonObject)),
    dueDate: input.dueDate.toISOString(),
    publishedAt: input.publishedAt.toISOString(),
  });
}

export function distributeLiquidationAmountByLargestRemainder(
  units: readonly LiquidationDistributionUnit[],
  totalAmountMinor: number,
): LiquidationDistributionAllocation[] {
  assertSafeIntegerNonNegative(totalAmountMinor, 'totalAmountMinor');

  if (units.length === 0) {
    if (totalAmountMinor === 0) {
      return [];
    }

    throw new BadRequestException(
      'Liquidation publication snapshot requires billable units to allocate a positive amount',
    );
  }

  const normalizedUnits = units.map(normalizeDistributionUnit);
  const totalAreaM2 = normalizedUnits.reduce(
    (sum, unit) => safeAddFinite(sum, unit.areaM2, 'units.totalAreaM2'),
    0,
  );

  if (totalAreaM2 === 0) {
    throw new BadRequestException(
      'Liquidation publication snapshot units must have a positive allocation area',
    );
  }

  const rankedAllocations = normalizedUnits.map((unit, index) => {
    const exactShare = (totalAmountMinor * unit.areaM2) / totalAreaM2;
    const amountMinor = Math.floor(exactShare);

    return {
      unit,
      originalIndex: index,
      amountMinor,
      fraction: exactShare - amountMinor,
    };
  });

  let allocatedMinor = rankedAllocations.reduce(
    (sum, allocation) => safeAddMinor(sum, allocation.amountMinor, 'allocations.totalAmountMinor'),
    0,
  );
  const remainder = totalAmountMinor - allocatedMinor;

  if (!Number.isSafeInteger(remainder) || remainder < 0) {
    throw new BadRequestException(
      'Liquidation publication snapshot allocations must match the liquidation total',
    );
  }

  const winners = [...rankedAllocations]
    .sort((left, right) => {
      if (right.fraction !== left.fraction) {
        return right.fraction - left.fraction;
      }

      const unitIdComparison = left.unit.id.localeCompare(right.unit.id);
      if (unitIdComparison !== 0) {
        return unitIdComparison;
      }

      const unitCodeComparison = left.unit.code.localeCompare(right.unit.code);
      if (unitCodeComparison !== 0) {
        return unitCodeComparison;
      }

      return left.originalIndex - right.originalIndex;
    })
    .slice(0, remainder);

  for (const winner of winners) {
    winner.amountMinor += 1;
  }

  const finalTotal = rankedAllocations.reduce(
    (sum, allocation) => safeAddMinor(sum, allocation.amountMinor, 'allocations.totalAmountMinor'),
    0,
  );

  if (finalTotal !== totalAmountMinor) {
    throw new BadRequestException(
      'Liquidation publication snapshot allocations must match the liquidation total',
    );
  }

  return rankedAllocations
    .slice()
    .sort((left, right) => {
      const unitIdComparison = left.unit.id.localeCompare(right.unit.id);
      if (unitIdComparison !== 0) {
        return unitIdComparison;
      }

      const unitCodeComparison = left.unit.code.localeCompare(right.unit.code);
      if (unitCodeComparison !== 0) {
        return unitCodeComparison;
      }

      return left.originalIndex - right.originalIndex;
    })
    .map((allocation) => ({
      unitId: allocation.unit.id,
      unitCode: allocation.unit.code,
      unitLabel: allocation.unit.label,
      areaM2: allocation.unit.areaM2,
      amountMinor: allocation.amountMinor,
    }));
}

export function parseLiquidationPublicationSnapshot(
  value: unknown,
): LiquidationPublicationSnapshot | null {
  if (value === null) {
    return null;
  }

  if (!isPlainObject(value)) {
    throw new BadRequestException('Liquidation publication snapshot is invalid');
  }

  if (value.version !== 1 && value.version !== 2 && value.version !== 3) {
    throw new BadRequestException('Liquidation publication snapshot version is invalid');
  }

  const liquidationId = parseNonEmptyString(value.liquidationId, 'liquidationId');
  const tenantId = parseNonEmptyString(value.tenantId, 'tenantId');
  const buildingId = parseNonEmptyString(value.buildingId, 'buildingId');
  const period = parseNonEmptyString(value.period, 'period');
  const baseCurrency = parseNonEmptyString(value.baseCurrency, 'baseCurrency');
  const totalAmountMinor = parseSafeIntegerNonNegative(value.totalAmountMinor, 'totalAmountMinor');
  const totalsByCurrency = parseTotalsByCurrency(value.totalsByCurrency);
  const dueDate = parseIsoDateString(value.dueDate, 'dueDate');
  const publishedAt = parseIsoDateString(value.publishedAt, 'publishedAt');
  const valuationMode =
    value.version === 1
      ? ('LEGACY_NOMINAL' as const)
      : parseValuationMode(value.valuationMode);

  if (!Array.isArray(value.expenses)) {
    throw new BadRequestException('Liquidation publication snapshot expenses are invalid');
  }

  if (!Array.isArray(value.allocations)) {
    throw new BadRequestException('Liquidation publication snapshot allocations are invalid');
  }

  const expenses = value.expenses.map(parseExpenseSnapshot);
  const allocations = value.allocations.map(parseAllocationSnapshot);
  const expenseTotalsByCurrency = sumByCurrency(expenses);
  const allocationTotal = allocations.reduce(
    (sum, allocation) =>
      safeAddMinor(sum, allocation.amountMinor, 'allocations.totalAmountMinor'),
    0,
  );
  const valuedTotal =
    valuationMode === 'FUNCTIONAL'
      ? sumFunctionalAmount(expenses, valuationMode)
      : totalsByCurrency[baseCurrency];

  if (valuedTotal === undefined) {
    throw new BadRequestException(
      'Liquidation publication snapshot must include the base currency total',
    );
  }

  if (allocationTotal !== totalAmountMinor) {
    throw new BadRequestException(
      'Liquidation publication snapshot allocations must match the liquidation total',
    );
  }

  assertCurrencyTotalsMatch(totalsByCurrency, expenseTotalsByCurrency);

  if (value.version === 3) {
    const grossExpenseAmountMinor = parseSafeIntegerNonNegative(
      value.grossExpenseAmountMinor,
      'grossExpenseAmountMinor',
    );
    const adjustmentAmountMinor = parseSafeIntegerNonNegative(
      value.adjustmentAmountMinor,
      'adjustmentAmountMinor',
    );
    const preIncomeAmountMinor = parseSafeIntegerNonNegative(
      value.preIncomeAmountMinor,
      'preIncomeAmountMinor',
    );
    const incomeOffsetAmountMinor = parseSafeIntegerNonNegative(
      value.incomeOffsetAmountMinor,
      'incomeOffsetAmountMinor',
    );
    const netDistributableAmountMinor = parseSafeIntegerNonNegative(
      value.netDistributableAmountMinor,
      'netDistributableAmountMinor',
    );

    if (grossExpenseAmountMinor + adjustmentAmountMinor !== preIncomeAmountMinor) {
      throw new BadRequestException(
        'Liquidation publication snapshot pre-income total is inconsistent',
      );
    }

    if (preIncomeAmountMinor - incomeOffsetAmountMinor !== netDistributableAmountMinor) {
      throw new BadRequestException(
        'Liquidation publication snapshot net distributable is inconsistent',
      );
    }

    if (netDistributableAmountMinor !== totalAmountMinor) {
      throw new BadRequestException(
        'Liquidation publication snapshot total must equal net distributable',
      );
    }

    if (valuedTotal !== preIncomeAmountMinor) {
      throw new BadRequestException(
        'Liquidation publication snapshot expense sources must match pre-income total',
      );
    }

    if (!Array.isArray(value.incomeOffsets)) {
      throw new BadRequestException('Liquidation publication snapshot incomeOffsets are invalid');
    }

    const incomeOffsets = value.incomeOffsets.map(parseIncomeOffsetSnapshot);
    const incomeOffsetValuedTotal = incomeOffsets.reduce(
      (sum, offset) =>
        safeAddMinor(sum, offset.valuedAmountMinor, 'incomeOffsets.valuedAmountMinor'),
      0,
    );

    if (incomeOffsetValuedTotal !== incomeOffsetAmountMinor) {
      throw new BadRequestException(
        'Liquidation publication snapshot income offsets must match the offset total',
      );
    }

    // FIN-06R: incomeOffsetsByCurrency debe reconciliar exactamente a
    // { baseCurrency: incomeOffsetAmountMinor } cuando offset > 0.
    const incomeOffsetsByCurrency = parseTotalsByCurrency(value.incomeOffsetsByCurrency);
    if (incomeOffsetAmountMinor > 0) {
      const expected = { [baseCurrency]: incomeOffsetAmountMinor };
      const isExact =
        Object.keys(incomeOffsetsByCurrency).length === 1 &&
        incomeOffsetsByCurrency[baseCurrency] === expected[baseCurrency];
      if (!isExact) {
        throw new BadRequestException(
          'Liquidation publication snapshot incomeOffsetsByCurrency must match the offset total in base currency',
        );
      }
    } else if (Object.keys(incomeOffsetsByCurrency).length > 0) {
      throw new BadRequestException(
        'Liquidation publication snapshot incomeOffsetsByCurrency must be empty for zero offsets',
      );
    }

    return {
      version: 3,
      valuationMode,
      liquidationId,
      tenantId,
      buildingId,
      period,
      baseCurrency,
      totalAmountMinor,
      totalsByCurrency,
      grossExpenseAmountMinor,
      adjustmentAmountMinor,
      preIncomeAmountMinor,
      incomeOffsetAmountMinor,
      netDistributableAmountMinor,
      incomeOffsetsByCurrency,
      expenses,
      incomeOffsets,
      allocations,
      dueDate,
      publishedAt,
    };
  }

  if (valuedTotal !== totalAmountMinor) {
    throw new BadRequestException(
      'Liquidation publication snapshot totals must match the liquidation total',
    );
  }

  if (valuationMode === 'LEGACY_NOMINAL') {
    return {
      version: 1,
      liquidationId,
      tenantId,
      buildingId,
      period,
      baseCurrency,
      totalAmountMinor,
      totalsByCurrency,
      expenses,
      allocations,
      dueDate,
      publishedAt,
    };
  }

  return {
    version: 2,
    valuationMode,
    liquidationId,
    tenantId,
    buildingId,
    period,
    baseCurrency,
    totalAmountMinor,
    totalsByCurrency,
    expenses,
    allocations,
    dueDate,
    publishedAt,
  };
}

function parseValuationMode(value: unknown): 'FUNCTIONAL' | 'LEGACY_NOMINAL' {
  if (value === 'FUNCTIONAL' || value === 'LEGACY_NOMINAL') {
    return value;
  }
  throw new BadRequestException('Liquidation publication snapshot valuationMode is invalid');
}

function sumFunctionalAmount(
  items: readonly PublishedExpenseSnapshot[],
  valuationMode: 'FUNCTIONAL' | 'LEGACY_NOMINAL',
): number | undefined {
  if (valuationMode === 'LEGACY_NOMINAL') {
    return undefined;
  }

  return items.reduce((sum, item) => {
    if (item.functionalAmountMinor === null || item.functionalAmountMinor === undefined) {
      throw new BadRequestException(
        'Liquidation publication snapshot functional amount is invalid',
      );
    }
    return safeAddMinor(
      sum,
      item.functionalAmountMinor,
      `functionalAmountMinor:${item.expenseId}`,
    );
  }, 0);
}

function normalizeExpenseSnapshot(value: PublishedExpenseSnapshot): PublishedExpenseSnapshot {
  assertNonEmpty(value.expenseId, 'expenseId');
  assertNonEmpty(value.categoryName, 'categoryName');
  assertNonEmpty(value.currencyCode, 'currencyCode');
  parseIsoDateString(value.invoiceDate, 'invoiceDate');
  assertSafeIntegerNonNegative(value.amountMinor, 'amountMinor');

  if (value.vendorName !== null) {
    assertNonEmpty(value.vendorName, 'vendorName');
  }

  if (value.description !== null) {
    assertNonEmpty(value.description, 'description');
  }

  const sourcePeriod = value.sourcePeriod;
  if (sourcePeriod !== undefined && sourcePeriod !== null) {
    assertNonEmpty(sourcePeriod, 'sourcePeriod');
  }

  if (value.type !== 'EXPENSE' && value.type !== 'ADJUSTMENT') {
    throw new BadRequestException('Liquidation publication snapshot expense type is invalid');
  }

  return {
    expenseId: value.expenseId,
    categoryName: value.categoryName,
    vendorName: value.vendorName,
    amountMinor: value.amountMinor,
    currencyCode: value.currencyCode,
    invoiceDate: value.invoiceDate,
    description: value.description,
    type: value.type,
    ...(sourcePeriod ? { sourcePeriod } : {}),
    ...(value.functionalAmountMinor !== null && value.functionalAmountMinor !== undefined
      ? { functionalAmountMinor: value.functionalAmountMinor }
      : {}),
    ...(value.functionalCurrencyCode !== null && value.functionalCurrencyCode !== undefined
      ? { functionalCurrencyCode: value.functionalCurrencyCode }
      : {}),
    ...(value.exchangeRateId !== null && value.exchangeRateId !== undefined
      ? { exchangeRateId: value.exchangeRateId }
      : {}),
    ...(value.exchangeRateValue !== null && value.exchangeRateValue !== undefined
      ? { exchangeRateValue: value.exchangeRateValue }
      : {}),
    ...(value.exchangeRateDirection !== null && value.exchangeRateDirection !== undefined
      ? { exchangeRateDirection: value.exchangeRateDirection }
      : {}),
    ...(value.exchangeRateEffectiveAt !== null && value.exchangeRateEffectiveAt !== undefined
      ? { exchangeRateEffectiveAt: value.exchangeRateEffectiveAt }
      : {}),
    ...(value.conversionDate !== null && value.conversionDate !== undefined
      ? { conversionDate: value.conversionDate }
      : {}),
  };
}

function normalizeIncomeOffsetSnapshot(
  value: PublishedIncomeOffsetSnapshot,
): PublishedIncomeOffsetSnapshot {
  assertNonEmpty(value.incomeId, 'incomeId');
  assertNonEmpty(value.incomeApplicationId, 'incomeApplicationId');
  assertNonEmpty(value.currencyCode, 'currencyCode');
  assertNonEmpty(value.scopeType, 'scopeType');
  assertSafeIntegerNonNegative(value.applicationAmountMinor, 'applicationAmountMinor');
  assertSafeIntegerNonNegative(value.buildingAmountMinor, 'buildingAmountMinor');
  assertSafeIntegerNonNegative(value.valuedAmountMinor, 'valuedAmountMinor');
  parseIsoDateString(value.receivedDate, 'receivedDate');
  assertNonEmpty(value.period, 'period');
  if (value.policyVersionId !== null) {
    assertNonEmpty(value.policyVersionId, 'policyVersionId');
  }
  if (value.categoryId) {
    assertNonEmpty(value.categoryId, 'categoryId');
  }

  return {
    ...value,
    legacyDestination: value.legacyDestination ?? null,
  };
}

function toIncomeOffsetJsonObject(value: PublishedIncomeOffsetSnapshot): Prisma.InputJsonObject {
  return createJsonObject({
    incomeId: value.incomeId,
    incomeApplicationId: value.incomeApplicationId,
    categoryId: value.categoryId,
    categoryName: value.categoryName,
    policyVersionId: value.policyVersionId,
    legacyDestination: value.legacyDestination ?? null,
    scopeType: value.scopeType,
    currencyCode: value.currencyCode,
    applicationAmountMinor: value.applicationAmountMinor,
    buildingAmountMinor: value.buildingAmountMinor,
    valuedAmountMinor: value.valuedAmountMinor,
    functionalCurrencyCode: value.functionalCurrencyCode,
    exchangeRateId: value.exchangeRateId,
    exchangeRateValue: value.exchangeRateValue,
    exchangeRateDirection: value.exchangeRateDirection,
    exchangeRateEffectiveAt: value.exchangeRateEffectiveAt,
    conversionDate: value.conversionDate,
    receivedDate: value.receivedDate,
    period: value.period,
  });
}

function parseIncomeOffsetSnapshot(value: unknown): PublishedIncomeOffsetSnapshot {
  if (!isPlainObject(value)) {
    throw new BadRequestException('Liquidation publication snapshot income offset is invalid');
  }

  const incomeId = parseNonEmptyString(value.incomeId, 'incomeId');
  const incomeApplicationId = parseNonEmptyString(value.incomeApplicationId, 'incomeApplicationId');
  const categoryId = value.categoryId === null || value.categoryId === undefined
    ? ''
    : parseNonEmptyString(value.categoryId, 'categoryId');
  const categoryName =
    value.categoryName === null || value.categoryName === undefined
      ? null
      : parseNullableString(value.categoryName, 'categoryName');
  const policyVersionId =
    value.policyVersionId === null || value.policyVersionId === undefined
      ? null
      : parseNullableString(value.policyVersionId, 'policyVersionId');
  const scopeType = parseNonEmptyString(value.scopeType, 'scopeType');
  const currencyCode = parseNonEmptyString(value.currencyCode, 'currencyCode');
  const applicationAmountMinor = parseSafeIntegerNonNegative(
    value.applicationAmountMinor,
    'applicationAmountMinor',
  );
  const buildingAmountMinor = parseSafeIntegerNonNegative(
    value.buildingAmountMinor,
    'buildingAmountMinor',
  );
  const valuedAmountMinor = parseSafeIntegerNonNegative(
    value.valuedAmountMinor,
    'valuedAmountMinor',
  );
  const functionalCurrencyCode =
    value.functionalCurrencyCode === null || value.functionalCurrencyCode === undefined
      ? null
      : parseNullableString(value.functionalCurrencyCode, 'functionalCurrencyCode');
  const exchangeRateId =
    value.exchangeRateId === null || value.exchangeRateId === undefined
      ? null
      : parseNullableString(value.exchangeRateId, 'exchangeRateId');
  const exchangeRateValue =
    value.exchangeRateValue === null || value.exchangeRateValue === undefined
      ? null
      : parseNullableString(String(value.exchangeRateValue), 'exchangeRateValue');
  const exchangeRateDirection =
    value.exchangeRateDirection === null || value.exchangeRateDirection === undefined
      ? null
      : parseNullableString(value.exchangeRateDirection, 'exchangeRateDirection');
  const exchangeRateEffectiveAt =
    value.exchangeRateEffectiveAt === null || value.exchangeRateEffectiveAt === undefined
      ? null
      : parseIsoDateString(value.exchangeRateEffectiveAt, 'exchangeRateEffectiveAt');
  const conversionDate =
    value.conversionDate === null || value.conversionDate === undefined
      ? null
      : parseIsoDateString(value.conversionDate, 'conversionDate');
  const receivedDate = parseIsoDateString(value.receivedDate, 'receivedDate');
  const period = parseNonEmptyString(value.period, 'period');
  // FIN-04R: V3 histórico sin field → null (backward compatible).
  const legacyDestination =
    value.legacyDestination === null || value.legacyDestination === undefined
      ? null
      : parseNullableString(value.legacyDestination, 'legacyDestination');

  return {
    incomeId,
    incomeApplicationId,
    categoryId,
    categoryName,
    policyVersionId,
    legacyDestination,
    scopeType,
    currencyCode,
    applicationAmountMinor,
    buildingAmountMinor,
    valuedAmountMinor,
    functionalCurrencyCode,
    exchangeRateId,
    exchangeRateValue,
    exchangeRateDirection,
    exchangeRateEffectiveAt,
    conversionDate,
    receivedDate,
    period,
  };
}

function normalizeAllocationSnapshot(value: PublishedAllocationSnapshot): PublishedAllocationSnapshot {
  assertNonEmpty(value.unitId, 'unitId');
  assertNonEmpty(value.unitCode, 'unitCode');
  assertSafeIntegerNonNegative(value.amountMinor, 'amountMinor');
  if (value.unitLabel !== null) {
    assertNonEmpty(value.unitLabel, 'unitLabel');
  }

  return {
    unitId: value.unitId,
    unitCode: value.unitCode,
    unitLabel: value.unitLabel,
    amountMinor: value.amountMinor,
  };
}

function normalizeDistributionUnit(
  value: LiquidationDistributionUnit,
): LiquidationDistributionUnit {
  assertNonEmpty(value.id, 'unit.id');
  assertNonEmpty(value.code, 'unit.code');
  if (value.label !== null) {
    assertNonEmpty(value.label, 'unit.label');
  }
  if (typeof value.areaM2 !== 'number' || !Number.isFinite(value.areaM2) || value.areaM2 < 0) {
    throw new BadRequestException('Liquidation publication snapshot unit areaM2 is invalid');
  }

  return {
    id: value.id,
    code: value.code,
    label: value.label,
    areaM2: value.areaM2,
  };
}

function toExpenseJsonObject(value: PublishedExpenseSnapshot): Prisma.InputJsonObject {
  return createJsonObject({
    expenseId: value.expenseId,
    categoryName: value.categoryName,
    vendorName: value.vendorName,
    amountMinor: value.amountMinor,
    currencyCode: value.currencyCode,
    invoiceDate: value.invoiceDate,
    description: value.description,
    type: value.type,
    ...(value.sourcePeriod ? { sourcePeriod: value.sourcePeriod } : {}),
    ...(value.functionalAmountMinor !== null && value.functionalAmountMinor !== undefined
      ? { functionalAmountMinor: value.functionalAmountMinor }
      : {}),
    ...(value.functionalCurrencyCode !== null && value.functionalCurrencyCode !== undefined
      ? { functionalCurrencyCode: value.functionalCurrencyCode }
      : {}),
    ...(value.exchangeRateId !== null && value.exchangeRateId !== undefined
      ? { exchangeRateId: value.exchangeRateId }
      : {}),
    ...(value.exchangeRateValue !== null && value.exchangeRateValue !== undefined
      ? { exchangeRateValue: value.exchangeRateValue }
      : {}),
    ...(value.exchangeRateDirection !== null && value.exchangeRateDirection !== undefined
      ? { exchangeRateDirection: value.exchangeRateDirection }
      : {}),
    ...(value.exchangeRateEffectiveAt !== null && value.exchangeRateEffectiveAt !== undefined
      ? { exchangeRateEffectiveAt: value.exchangeRateEffectiveAt }
      : {}),
    ...(value.conversionDate !== null && value.conversionDate !== undefined
      ? { conversionDate: value.conversionDate }
      : {}),
  });
}

function toAllocationJsonObject(value: PublishedAllocationSnapshot): Prisma.InputJsonObject {
  return createJsonObject({
    unitId: value.unitId,
    unitCode: value.unitCode,
    unitLabel: value.unitLabel,
    amountMinor: value.amountMinor,
  });
}

function parseExpenseSnapshot(value: unknown): PublishedExpenseSnapshot {
  if (!isPlainObject(value)) {
    throw new BadRequestException('Liquidation publication snapshot expense is invalid');
  }

  const expenseId = parseNonEmptyString(value.expenseId, 'expenseId');
  const categoryName = parseNonEmptyString(value.categoryName, 'categoryName');
  const vendorName = parseNullableString(value.vendorName, 'vendorName');
  const amountMinor = parseSafeIntegerNonNegative(value.amountMinor, 'amountMinor');
  const currencyCode = parseNonEmptyString(value.currencyCode, 'currencyCode');
  const invoiceDate = parseIsoDateString(value.invoiceDate, 'invoiceDate');
  const description = parseNullableString(value.description, 'description');
  const type = parseNonEmptyString(value.type, 'type');

  if (type !== 'EXPENSE' && type !== 'ADJUSTMENT') {
    throw new BadRequestException('Liquidation publication snapshot expense type is invalid');
  }

  const sourcePeriod =
    value.sourcePeriod === undefined || value.sourcePeriod === null
      ? undefined
      : parseNonEmptyString(value.sourcePeriod, 'sourcePeriod');

  const functionalAmountMinor =
    value.functionalAmountMinor === undefined || value.functionalAmountMinor === null
      ? undefined
      : parseSafeIntegerNonNegative(value.functionalAmountMinor, 'functionalAmountMinor');
  const functionalCurrencyCode =
    value.functionalCurrencyCode === undefined || value.functionalCurrencyCode === null
      ? undefined
      : parseNonEmptyString(value.functionalCurrencyCode, 'functionalCurrencyCode');
  const exchangeRateId =
    value.exchangeRateId === undefined || value.exchangeRateId === null
      ? undefined
      : parseNonEmptyString(value.exchangeRateId, 'exchangeRateId');
  const exchangeRateValue =
    value.exchangeRateValue === undefined || value.exchangeRateValue === null
      ? undefined
      : parseNonEmptyString(String(value.exchangeRateValue), 'exchangeRateValue');
  const exchangeRateDirection =
    value.exchangeRateDirection === undefined || value.exchangeRateDirection === null
      ? undefined
      : parseNonEmptyString(value.exchangeRateDirection, 'exchangeRateDirection');
  const exchangeRateEffectiveAt =
    value.exchangeRateEffectiveAt === undefined || value.exchangeRateEffectiveAt === null
      ? undefined
      : parseIsoDateString(value.exchangeRateEffectiveAt, 'exchangeRateEffectiveAt');
  const conversionDate =
    value.conversionDate === undefined || value.conversionDate === null
      ? undefined
      : parseIsoDateString(value.conversionDate, 'conversionDate');

  return {
    expenseId,
    categoryName,
    vendorName,
    amountMinor,
    currencyCode,
    invoiceDate,
    description,
    type,
    ...(sourcePeriod ? { sourcePeriod } : {}),
    ...(functionalAmountMinor !== undefined ? { functionalAmountMinor } : {}),
    ...(functionalCurrencyCode !== undefined ? { functionalCurrencyCode } : {}),
    ...(exchangeRateId !== undefined ? { exchangeRateId } : {}),
    ...(exchangeRateValue !== undefined ? { exchangeRateValue } : {}),
    ...(exchangeRateDirection !== undefined ? { exchangeRateDirection } : {}),
    ...(exchangeRateEffectiveAt !== undefined ? { exchangeRateEffectiveAt } : {}),
    ...(conversionDate !== undefined ? { conversionDate } : {}),
  };
}

function parseAllocationSnapshot(value: unknown): PublishedAllocationSnapshot {
  if (!isPlainObject(value)) {
    throw new BadRequestException('Liquidation publication snapshot allocation is invalid');
  }

  const unitId = parseNonEmptyString(value.unitId, 'unitId');
  const unitCode = parseNonEmptyString(value.unitCode, 'unitCode');
  const unitLabel = parseNullableString(value.unitLabel, 'unitLabel');
  const amountMinor = parseSafeIntegerNonNegative(value.amountMinor, 'amountMinor');

  return {
    unitId,
    unitCode,
    unitLabel,
    amountMinor,
  };
}

function normalizeTotalsByCurrency(value: Record<string, number>): Record<string, number> {
  if (!isPlainObject(value)) {
    throw new BadRequestException('Liquidation publication snapshot totalsByCurrency is invalid');
  }

  const totals: Record<string, number> = {};

  for (const [currencyCode, amount] of Object.entries(value)) {
    assertNonEmpty(currencyCode, `totalsByCurrency.${currencyCode}`);
    totals[currencyCode] = parseSafeIntegerNonNegative(amount, `totalsByCurrency.${currencyCode}`);
  }

  return totals;
}

function parseTotalsByCurrency(value: unknown): Record<string, number> {
  if (!isPlainObject(value)) {
    throw new BadRequestException('Liquidation publication snapshot totalsByCurrency is invalid');
  }

  const totals: Record<string, number> = {};

  for (const [currencyCode, amount] of Object.entries(value)) {
    if (!currencyCode.trim()) {
      throw new BadRequestException('Liquidation publication snapshot currency code is invalid');
    }

    totals[currencyCode] = parseSafeIntegerNonNegative(amount, `totalsByCurrency.${currencyCode}`);
  }

  return totals;
}

function sumByCurrency(
  items: ReadonlyArray<{
    currencyCode: string;
    amountMinor: number;
  }>,
): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    assertNonEmpty(item.currencyCode, 'currencyCode');
    assertSafeIntegerNonNegative(item.amountMinor, `amountMinor:${item.currencyCode}`);
    acc[item.currencyCode] = safeAddMinor(
      acc[item.currencyCode] ?? 0,
      item.amountMinor,
      `totalsByCurrency.${item.currencyCode}`,
    );
    return acc;
  }, {});
}

function safeAddMinor(left: number, right: number, field: string): number {
  const total = left + right;

  if (!Number.isSafeInteger(total) || total < 0) {
    throw new BadRequestException(`Liquidation publication snapshot ${field} is invalid`);
  }

  return total;
}

function safeAddFinite(left: number, right: number, field: string): number {
  const total = left + right;

  if (!Number.isFinite(total) || total < 0) {
    throw new BadRequestException(`Liquidation publication snapshot ${field} is invalid`);
  }

  return total;
}

function assertCurrencyTotalsMatch(
  declaredTotals: Record<string, number>,
  actualTotals: Record<string, number>,
): void {
  const declaredCurrencies = Object.keys(declaredTotals);
  const actualCurrencies = Object.keys(actualTotals);

  for (const currencyCode of declaredCurrencies) {
    const declaredAmount = declaredTotals[currencyCode];
    const actualAmount = actualTotals[currencyCode] ?? 0;

    if (declaredAmount !== actualAmount) {
      throw new BadRequestException(
        'Liquidation publication snapshot currency totals are inconsistent',
      );
    }
  }

  for (const currencyCode of actualCurrencies) {
    if (!(currencyCode in declaredTotals)) {
      throw new BadRequestException(
        'Liquidation publication snapshot currency totals are inconsistent',
      );
    }
  }
}

function parseNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`Liquidation publication snapshot ${field} is invalid`);
  }

  return value;
}

function parseNullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }

  return parseNonEmptyString(value, field);
}

function parseSafeIntegerNonNegative(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new BadRequestException(`Liquidation publication snapshot ${field} is invalid`);
  }

  return value;
}

function parseIsoDateString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`Liquidation publication snapshot ${field} is invalid`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`Liquidation publication snapshot ${field} is invalid`);
  }

  return parsed.toISOString();
}

function assertIsoDate(value: Date, field: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new BadRequestException(`Liquidation publication snapshot ${field} is invalid`);
  }
}

function assertNonEmpty(value: string | null | undefined, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`Liquidation publication snapshot ${field} is invalid`);
  }
}

function assertSafeIntegerNonNegative(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BadRequestException(`Liquidation publication snapshot ${field} is invalid`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createJsonObject<T extends Prisma.InputJsonObject>(value: T): T {
  return value;
}

function createJsonArray<T extends Prisma.InputJsonArray>(value: T): T {
  return value;
}
