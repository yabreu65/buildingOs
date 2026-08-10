import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type LiquidationValuationMode = 'FUNCTIONAL' | 'LEGACY_NOMINAL';

export interface LiquidationValuationSource {
  id: string;
  type: 'EXPENSE' | 'ADJUSTMENT';
  amountMinor: number;
  currencyCode: string;
  functionalAmountMinor: number | null;
  functionalCurrencyCode: string | null;
  exchangeRateId: string | null;
  exchangeRateValue: string | number | { toString(): string } | null;
  exchangeRateDirection: string | null;
  exchangeRateEffectiveAt: Date | string | null;
  conversionDate: Date | string | null;
}

const VALID_DIRECTIONS = new Set(['IDENTITY', 'DIRECT', 'INVERSE']);

function functionalSnapshotRequired(message: string): never {
  throw new UnprocessableEntityException({
    statusCode: 422,
    error: 'LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED',
    message,
  });
}

function rateToString(
  value: string | number | { toString(): string } | null,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return value.toString();
}

export function isFunctionalSnapshotPresent(
  source: LiquidationValuationSource,
): boolean {
  return (
    source.functionalAmountMinor != null ||
    source.functionalCurrencyCode != null ||
    source.exchangeRateId != null ||
    rateToString(source.exchangeRateValue) != null ||
    source.exchangeRateDirection != null ||
    source.exchangeRateEffectiveAt != null ||
    source.conversionDate != null
  );
}

export function assertFunctionalSnapshotComplete(
  source: LiquidationValuationSource,
  baseCurrency: string,
): void {
  const rate = rateToString(source.exchangeRateValue);

  if (source.functionalAmountMinor === null) {
    functionalSnapshotRequired(
      `La fuente ${source.type}:${source.id} no posee functionalAmountMinor`,
    );
  }
  if (source.functionalCurrencyCode === null) {
    functionalSnapshotRequired(
      `La fuente ${source.type}:${source.id} no posee functionalCurrencyCode`,
    );
  }
  if (source.functionalCurrencyCode !== baseCurrency) {
    functionalSnapshotRequired(
      `La fuente ${source.type}:${source.id} está en ${source.functionalCurrencyCode}, ` +
        `se esperaba la moneda base de la liquidación (${baseCurrency})`,
    );
  }
  if (rate === null) {
    functionalSnapshotRequired(
      `La fuente ${source.type}:${source.id} no posee exchangeRateValue`,
    );
  }
  if (
    source.exchangeRateDirection === null ||
    !VALID_DIRECTIONS.has(source.exchangeRateDirection)
  ) {
    functionalSnapshotRequired(
      `La fuente ${source.type}:${source.id} no posee una dirección de conversión válida`,
    );
  }
  if (source.conversionDate === null) {
    functionalSnapshotRequired(
      `La fuente ${source.type}:${source.id} no posee conversionDate`,
    );
  }

  const rateDecimal = new Prisma.Decimal(rate);

  if (source.exchangeRateDirection === 'IDENTITY') {
    if (!rateDecimal.equals(1)) {
      functionalSnapshotRequired(
        `La fuente ${source.type}:${source.id} es IDENTITY pero su tasa no es 1`,
      );
    }
    if (source.exchangeRateId !== null || source.exchangeRateEffectiveAt !== null) {
      functionalSnapshotRequired(
        `La fuente ${source.type}:${source.id} es IDENTITY pero referencia una tasa`,
      );
    }
    return;
  }

  if (source.exchangeRateDirection === 'DIRECT' || source.exchangeRateDirection === 'INVERSE') {
    if (!rateDecimal.greaterThan(0)) {
      functionalSnapshotRequired(
        `La fuente ${source.type}:${source.id} posee una tasa no positiva`,
      );
    }
    if (source.exchangeRateId === null) {
      functionalSnapshotRequired(
        `La fuente ${source.type}:${source.id} no referencia la tasa fuente`,
      );
    }
    if (source.exchangeRateEffectiveAt === null) {
      functionalSnapshotRequired(
        `La fuente ${source.type}:${source.id} no posee la efectividad de la tasa`,
      );
    }
    return;
  }
}

export function determineLiquidationValuationMode(
  sources: readonly LiquidationValuationSource[],
  baseCurrency: string,
): LiquidationValuationMode {
  if (sources.length === 0) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED',
      message: 'La liquidación no posee fuentes valorables',
    });
  }

  let functionalCount = 0;
  for (const source of sources) {
    if (isFunctionalSnapshotPresent(source)) {
      functionalCount += 1;
    }
  }

  if (functionalCount === 0) {
    const currencies = new Set(sources.map((source) => source.currencyCode));
    if (currencies.size > 1) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'MIXED_CURRENCY_LIQUIDATION_NOT_SUPPORTED',
        message:
          'No se puede generar una liquidación con movimientos en distintas monedas.',
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
    return 'LEGACY_NOMINAL';
  }

  if (functionalCount !== sources.length) {
    functionalSnapshotRequired(
      'La liquidación mezcla fuentes con snapshot funcional y fuentes legacy; ' +
        'no se permite un modo parcial',
    );
  }

  for (const source of sources) {
    assertFunctionalSnapshotComplete(source, baseCurrency);
  }

  return 'FUNCTIONAL';
}

export function sumValuationAmounts(
  sources: readonly LiquidationValuationSource[],
  mode: LiquidationValuationMode,
): number {
  return sources.reduce((sum, source) => {
    const amount =
      mode === 'FUNCTIONAL' ? source.functionalAmountMinor : source.amountMinor;
    if (amount === null || amount === undefined) {
      functionalSnapshotRequired(
        `La fuente ${source.type}:${source.id} no aporta monto valorable`,
      );
    }
    return sum + amount;
  }, 0);
}
