import { UnprocessableEntityException } from '@nestjs/common';
import { classifyFunctionalSnapshot, isFunctionalSnapshotPresent } from './functional-snapshot';

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

function functionalSnapshotRequired(message: string): never {
  throw new UnprocessableEntityException({
    statusCode: 422,
    error: 'LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED',
    message,
  });
}

export { isFunctionalSnapshotPresent };

export function assertFunctionalSnapshotComplete(
  source: LiquidationValuationSource,
  baseCurrency: string,
): void {
  const state = classifyFunctionalSnapshot(source);
  if (state !== 'COMPLETE') {
    functionalSnapshotRequired(
      `La fuente ${source.type}:${source.id} posee un snapshot funcional incompleto o incoherente`,
    );
  }
  if (source.functionalCurrencyCode !== baseCurrency) {
    functionalSnapshotRequired(
      `La fuente ${source.type}:${source.id} está en ${source.functionalCurrencyCode}, ` +
        `se esperaba la moneda base de la liquidación (${baseCurrency})`,
    );
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
