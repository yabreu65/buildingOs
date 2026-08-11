import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Generic functional FX snapshot classification shared by Liquidation (3D)
 * and Payment (3E2). One semantic definition for COMPLETE / LEGACY_NULL /
 * PARTIAL_INVALID — never treat a partially populated set as legacy.
 */

export type FunctionalSnapshotState = 'COMPLETE' | 'LEGACY_NULL' | 'PARTIAL_INVALID';

export interface FunctionalSnapshotFields {
  functionalAmountMinor: number | null;
  functionalCurrencyCode: string | null;
  exchangeRateId: string | null;
  exchangeRateValue: string | number | { toString(): string } | null;
  exchangeRateDirection: string | null;
  exchangeRateEffectiveAt: Date | string | null;
  conversionDate: Date | string | null;
}

const VALID_DIRECTIONS = new Set(['IDENTITY', 'DIRECT', 'INVERSE']);

export function snapshotRateToString(
  value: string | number | { toString(): string } | null,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return value.toString();
}

export function isFunctionalSnapshotPresent(
  fields: FunctionalSnapshotFields,
): boolean {
  return (
    fields.functionalAmountMinor != null ||
    fields.functionalCurrencyCode != null ||
    fields.exchangeRateId != null ||
    snapshotRateToString(fields.exchangeRateValue) != null ||
    fields.exchangeRateDirection != null ||
    fields.exchangeRateEffectiveAt != null ||
    fields.conversionDate != null
  );
}

/**
 * Classifies a snapshot:
 * - LEGACY_NULL: every field is null.
 * - COMPLETE: semantically coherent snapshot (see rules below).
 * - PARTIAL_INVALID: any mixed/incoherent combination.
 *
 * Common required fields for a present snapshot:
 * functionalAmountMinor, functionalCurrencyCode, exchangeRateValue,
 * exchangeRateDirection, conversionDate.
 *
 * IDENTITY: direction == IDENTITY, rate == 1, rateId null, effectiveAt null.
 * DIRECT/INVERSE: rate > 0, rateId != null, effectiveAt != null.
 */
export function classifyFunctionalSnapshot(
  fields: FunctionalSnapshotFields,
): FunctionalSnapshotState {
  if (!isFunctionalSnapshotPresent(fields)) {
    return 'LEGACY_NULL';
  }

  const rate = snapshotRateToString(fields.exchangeRateValue);

  if (fields.functionalAmountMinor === null) {
    return 'PARTIAL_INVALID';
  }
  if (fields.functionalCurrencyCode === null) {
    return 'PARTIAL_INVALID';
  }
  if (rate === null) {
    return 'PARTIAL_INVALID';
  }
  if (
    fields.exchangeRateDirection === null ||
    !VALID_DIRECTIONS.has(fields.exchangeRateDirection)
  ) {
    return 'PARTIAL_INVALID';
  }
  if (fields.conversionDate === null) {
    return 'PARTIAL_INVALID';
  }

  const rateDecimal = new Prisma.Decimal(rate);

  if (fields.exchangeRateDirection === 'IDENTITY') {
    if (!rateDecimal.equals(1)) {
      return 'PARTIAL_INVALID';
    }
    if (fields.exchangeRateId !== null || fields.exchangeRateEffectiveAt !== null) {
      return 'PARTIAL_INVALID';
    }
    return 'COMPLETE';
  }

  // DIRECT or INVERSE
  if (!rateDecimal.greaterThan(0)) {
    return 'PARTIAL_INVALID';
  }
  if (fields.exchangeRateId === null) {
    return 'PARTIAL_INVALID';
  }
  if (fields.exchangeRateEffectiveAt === null) {
    return 'PARTIAL_INVALID';
  }
  return 'COMPLETE';
}

export function assertFunctionalSnapshotComplete(
  fields: FunctionalSnapshotFields,
  baseCurrency: string,
): void {
  if (classifyFunctionalSnapshot(fields) !== 'COMPLETE') {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'FUNCTIONAL_SNAPSHOT_INVALID',
      message: 'El snapshot funcional es incompleto o incoherente',
    });
  }
  if (fields.functionalCurrencyCode !== baseCurrency) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'FUNCTIONAL_SNAPSHOT_INVALID',
      message: `El snapshot funcional no converge a la moneda base (${baseCurrency})`,
    });
  }
}

export interface PaymentSnapshotBuildInput {
  readonly amountMinor: number;
  readonly currencyCode: string;
  readonly functionalCurrency: string;
  readonly conversionDate: string; // YYYY-MM-DD
}

/**
 * Builds a complete functional snapshot for a Payment using the shared
 * conversion engine (never duplicated lookup/rounding). The conversion date
 * must already be normalized to YYYY-MM-DD.
 */
export async function buildPaymentFunctionalSnapshot(
  convert: (input: {
    tenantId: string;
    amount: number;
    originalCurrency: string;
    functionalCurrency: string;
    conversionDate: string;
  }) => Promise<{
    functionalAmount: number;
    functionalCurrency: string;
    sourceExchangeRateId: string | null;
    appliedRate: string;
    direction: 'IDENTITY' | 'DIRECT' | 'INVERSE';
    sourceEffectiveAt: Date | null;
    conversionDate: Date;
  }>,
  tenantId: string,
  input: PaymentSnapshotBuildInput,
): Promise<{
  functionalAmountMinor: number;
  functionalCurrencyCode: string;
  exchangeRateId: string | null;
  exchangeRateValue: string;
  exchangeRateDirection: 'IDENTITY' | 'DIRECT' | 'INVERSE';
  exchangeRateEffectiveAt: Date | null;
  conversionDate: Date;
}> {
  const result = await convert({
    tenantId,
    amount: input.amountMinor,
    originalCurrency: input.currencyCode,
    functionalCurrency: input.functionalCurrency,
    conversionDate: input.conversionDate,
  });

  return {
    functionalAmountMinor: result.functionalAmount,
    functionalCurrencyCode: result.functionalCurrency,
    exchangeRateId: result.sourceExchangeRateId,
    exchangeRateValue: result.appliedRate,
    exchangeRateDirection: result.direction,
    exchangeRateEffectiveAt: result.sourceEffectiveAt,
    conversionDate: result.conversionDate,
  };
}
