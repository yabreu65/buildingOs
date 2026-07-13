import { BadRequestException } from '@nestjs/common';
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
  const baseCurrencyTotal = totalsByCurrency[input.baseCurrency];

  if (baseCurrencyTotal === undefined) {
    throw new BadRequestException(
      'Liquidation publication snapshot must include the base currency total',
    );
  }

  if (baseCurrencyTotal !== input.totalAmountMinor) {
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
    version: 1,
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

export function parseLiquidationPublicationSnapshot(
  value: unknown,
): LiquidationPublicationSnapshotV1 | null {
  if (value === null) {
    return null;
  }

  if (!isPlainObject(value)) {
    throw new BadRequestException('Liquidation publication snapshot is invalid');
  }

  if (value.version !== 1) {
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

  if (totalsByCurrency[baseCurrency] === undefined) {
    throw new BadRequestException(
      'Liquidation publication snapshot must include the base currency total',
    );
  }

  if (totalsByCurrency[baseCurrency] !== totalAmountMinor) {
    throw new BadRequestException(
      'Liquidation publication snapshot totals must match the liquidation total',
    );
  }

  if (allocationTotal !== totalAmountMinor) {
    throw new BadRequestException(
      'Liquidation publication snapshot allocations must match the liquidation total',
    );
  }

  assertCurrencyTotalsMatch(totalsByCurrency, expenseTotalsByCurrency);

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
