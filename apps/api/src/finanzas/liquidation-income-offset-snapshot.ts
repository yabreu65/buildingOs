import { BadRequestException } from '@nestjs/common';
import type { IncomeOffsetSnapshotItem } from './liquidation-income-offsets.service';

/**
 * FIN-07CR4: parser/normalizador ÚNICO y autoritativo para el item de snapshot
 * de ingresos aplicados de una Liquidación (`IncomeOffsetSnapshotItem`).
 *
 * - Construye y devuelve un objeto normalizado que SATISFACE el contrato en
 *   tiempo de ejecución (nunca `undefined` a través de un cast).
 * - Fail-closed: datos NO nulos corruptos -> BadRequestException (nunca se
 *   degradan a null/[]/{} ni se descartan silenciosamente).
 * - Compatibilidad histórica: los campos nullables históricamente ausentes se
 *   normalizan a null (o `''` para categoryId) según el parser histórico de
 *   publicación; NO se inventa un valor que la autoridad no defina.
 *
 * Reutilizado por la LECTURA (`liquidations.service`), el WRITE de publicación
 * (`normalizeIncomeOffsetSnapshot`) y el READ de publicación (parseo del JSON
 * `publicationSnapshot`), evitando definiciones divergentes del contrato.
 */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function throwBadRequest(message: string): never {
  throw new BadRequestException(message);
}

/** String no vacío (trim) o lanza. */
export function assertNonEmptyString(
  value: unknown,
  message: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throwBadRequest(message);
  }
}

/** Entero seguro >= 0 o lanza. */
export function assertSafeIntegerNonNegative(value: unknown, message: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throwBadRequest(message);
  }
}

/** Entero seguro > 0 (montos de un item OFFSET: share real > 0). */
function assertSafeIntegerPositive(value: unknown, message: string): void {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throwBadRequest(message);
  }
}

/** Cadena ISO-8601 parseable o lanza. */
export function assertIsoDateString(value: unknown, message: string): void {
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    throwBadRequest(message);
  }
}

/** Período YYYY-MM con mes 01-12 (misma semántica del backend de finanzas). */
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const INCOME_OFFSET_SCOPE_TYPES = ['BUILDING', 'TENANT_SHARED', 'UNIT_GROUP'];

/** FIN-04/FIN-06: destino legacy válido del `IncomeDestination` persistido. */
const LEGACY_DESTINATIONS = ['APPLY_TO_EXPENSES', 'RESERVE_FUND', 'SPECIAL_FUND'];

/** Campo requerido no vacío. */
function requiredString(value: unknown, label: string, field: string): string {
  assertNonEmptyString(value, `Liquidation incomeOffsetSnapshot ${label}.${field} is invalid`);
  return value;
}

/** Campo nullable: ausente -> null; presente -> string no vacío. */
function nullableString(value: unknown, label: string, field: string): string | null {
  if (value === null || value === undefined) return null;
  assertNonEmptyString(value, `Liquidation incomeOffsetSnapshot ${label}.${field} is invalid`);
  return value;
}

/** Campo nullable ISO: ausente -> null; presente -> cadena ISO parseable. */
function nullableIsoDate(value: unknown, label: string, field: string): string | null {
  if (value === null || value === undefined) return null;
  assertIsoDateString(value, `Liquidation incomeOffsetSnapshot ${label}.${field} is invalid`);
  return value as string;
}

/**
 * Parsea y normaliza UN item del snapshot de ingresos. Devuelve el objeto
 * normalizado (todos los campos presentes y con el tipo correcto).
 */
export function parseIncomeOffsetSnapshotItem(
  value: unknown,
  label: string,
): IncomeOffsetSnapshotItem {
  if (!isPlainObject(value)) {
    throwBadRequest(`Liquidation incomeOffsetSnapshot ${label} is invalid`);
  }
  const item = value as Record<string, unknown>;

  const incomeId = requiredString(item.incomeId, label, 'incomeId');
  const incomeApplicationId = requiredString(item.incomeApplicationId, label, 'incomeApplicationId');
  // categoryId es requerido; la compatibilidad histórica normaliza ausencia -> ''.
  const categoryId =
    item.categoryId === null || item.categoryId === undefined
      ? ''
      : requiredString(item.categoryId, label, 'categoryId');
  const categoryName = nullableString(item.categoryName, label, 'categoryName');
  const policyVersionId = nullableString(item.policyVersionId, label, 'policyVersionId');

  const legacyDestination =
    item.legacyDestination === null || item.legacyDestination === undefined
      ? null
      : parseLegacyDestination(item.legacyDestination, label);

  const scopeType = requiredString(item.scopeType, label, 'scopeType');
  if (!INCOME_OFFSET_SCOPE_TYPES.includes(scopeType)) {
    throwBadRequest(`Liquidation incomeOffsetSnapshot ${label}.scopeType is invalid`);
  }

  const currencyCode = requiredString(item.currencyCode, label, 'currencyCode');

  // FIN-06: un item OFFSET representa una aplicación/share real elegible > 0.
  // Una liquidación con cero offsets se representa como `[]`, nunca con ítems 0.
  assertSafeIntegerPositive(item.applicationAmountMinor, `Liquidation incomeOffsetSnapshot ${label}.applicationAmountMinor is invalid`);
  assertSafeIntegerPositive(item.buildingAmountMinor, `Liquidation incomeOffsetSnapshot ${label}.buildingAmountMinor is invalid`);
  assertSafeIntegerPositive(item.valuedAmountMinor, `Liquidation incomeOffsetSnapshot ${label}.valuedAmountMinor is invalid`);

  const functionalCurrencyCode = nullableString(item.functionalCurrencyCode, label, 'functionalCurrencyCode');
  const exchangeRateId = nullableString(item.exchangeRateId, label, 'exchangeRateId');
  // exchangeRateValue: histórico puede venir numérico -> String() (misma
  // compatibilidad del parser de publicación), pero nunca ausente/vacío.
  const exchangeRateValue =
    item.exchangeRateValue === null || item.exchangeRateValue === undefined
      ? null
      : parseNonEmptyStringified(item.exchangeRateValue, label, 'exchangeRateValue');
  const exchangeRateDirection = nullableString(item.exchangeRateDirection, label, 'exchangeRateDirection');
  const exchangeRateEffectiveAt = nullableIsoDate(item.exchangeRateEffectiveAt, label, 'exchangeRateEffectiveAt');
  const conversionDate = nullableIsoDate(item.conversionDate, label, 'conversionDate');

  assertIsoDateString(item.receivedDate, `Liquidation incomeOffsetSnapshot ${label}.receivedDate is invalid`);
  const receivedDate = item.receivedDate as string;

  const period = requiredString(item.period, label, 'period');
  if (!PERIOD_PATTERN.test(period)) {
    throwBadRequest(`Liquidation incomeOffsetSnapshot ${label}.period is invalid`);
  }

  // Campos que NO forman parte del contrato del item pero, si aparecen en datos
  // persistidos, deben tener tipo coherente (no basta con que los IDs sean strings).
  if ('baseCurrency' in item && item.baseCurrency !== null && item.baseCurrency !== undefined) {
    assertNonEmptyString(
      item.baseCurrency,
      `Liquidation incomeOffsetSnapshot ${label}.baseCurrency is invalid`,
    );
  }
  if ('buildingId' in item && item.buildingId !== null && item.buildingId !== undefined) {
    assertNonEmptyString(
      item.buildingId,
      `Liquidation incomeOffsetSnapshot ${label}.buildingId is invalid`,
    );
  }

  return {
    incomeId,
    incomeApplicationId,
    categoryId,
    categoryName,
    policyVersionId,
    legacyDestination,
    scopeType,
    currencyCode,
    applicationAmountMinor: item.applicationAmountMinor as number,
    buildingAmountMinor: item.buildingAmountMinor as number,
    valuedAmountMinor: item.valuedAmountMinor as number,
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

function parseLegacyDestination(value: unknown, label: string): string {
  assertNonEmptyString(value, `Liquidation incomeOffsetSnapshot ${label}.legacyDestination is invalid`);
  if (!LEGACY_DESTINATIONS.includes(value)) {
    throwBadRequest(`Liquidation incomeOffsetSnapshot ${label}.legacyDestination is invalid`);
  }
  return value;
}

function parseNonEmptyStringified(value: unknown, label: string, field: string): string {
  const str = String(value);
  if (str.trim().length === 0) {
    throwBadRequest(`Liquidation incomeOffsetSnapshot ${label}.${field} is invalid`);
  }
  return str;
}

/**
 * `Liquidation.incomeOffsetSnapshot`:
 * null/undefined -> histórico (null)
 * []             -> V3 cero offsets
 * array          -> items parseados/normalizados uno a uno (fail-closed)
 */
export function parseIncomeOffsetSnapshot(
  value: unknown,
): IncomeOffsetSnapshotItem[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) {
    throwBadRequest('Liquidation incomeOffsetSnapshot is invalid');
  }
  return value.map((item, index) => parseIncomeOffsetSnapshotItem(item, `item ${index}`));
}

/**
 * `Liquidation.incomeOffsetsByCurrency`:
 * null/undefined -> histórico (null)
 * {}             -> V3 cero offsets
 * object         -> { currencyNoVacio: safeInt >= 0 } (fail-closed)
 * Los montos de este mapa mantienen semántica NON-NEGATIVE: `{}` es válido.
 */
export function parseIncomeOffsetsByCurrency(
  value: unknown,
): Record<string, number> | null {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) {
    throwBadRequest('Liquidation incomeOffsetsByCurrency is invalid');
  }
  const source = value as Record<string, unknown>;
  const result: Record<string, number> = {};
  for (const [currency, amount] of Object.entries(source)) {
    if (!currency || currency.trim().length === 0) {
      throwBadRequest('Liquidation incomeOffsetsByCurrency currency code is invalid');
    }
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) {
      throwBadRequest(`Liquidation incomeOffsetsByCurrency amount for ${currency} is invalid`);
    }
    result[currency] = amount;
  }
  return result;
}

/** Resultado de la clasificación de consistencia V3/histórica de una fila. */
export type LiquidationV3ReadKind = 'V3' | 'HISTORICAL';

/**
 * Clasificación de consistencia de los campos de resumen FIN-06 persistidos:
 *
 * - los 5 campos presentes  -> V3 moderna
 * - los 5 ausentes/null     -> histórico V1/V2
 * - presencia PARCIAL       -> corrupto (fail-closed)
 */
export function classifyLiquidationV3Summary(values: {
  grossExpenseAmountMinor?: number | null;
  adjustmentAmountMinor?: number | null;
  preIncomeAmountMinor?: number | null;
  incomeOffsetAmountMinor?: number | null;
  netDistributableAmountMinor?: number | null;
}): LiquidationV3ReadKind {
  const present = [
    values.grossExpenseAmountMinor,
    values.adjustmentAmountMinor,
    values.preIncomeAmountMinor,
    values.incomeOffsetAmountMinor,
    values.netDistributableAmountMinor,
  ].filter((value) => value !== null && value !== undefined).length;

  if (present === 5) return 'V3';
  if (present === 0) return 'HISTORICAL';

  throwBadRequest('Liquidation V3 summary fields are partially populated');
}
