import { Prisma } from '@prisma/client';

const EXCHANGE_RATE_LOCK_NAMESPACE = 'buildingos:exchange-rate:v1';
const EXCHANGE_RATE_PAIR_LOCK_NAMESPACE = 'buildingos:exchange-rate-pair:v1';

export type ExchangeRateLockClient = Pick<Prisma.TransactionClient, '$executeRaw'>;

/**
 * Transaction-scoped lock key for synchronizing ExchangeRate consumers and writers.
 *
 * Lock order for snapshot producers is: existing movement/entity lifecycle lock first,
 * then the currency-pair lock, then this ExchangeRate lock. ExchangeRate create paths
 * acquire only the currency-pair lock. ExchangeRate update/delete paths acquire the
 * currency-pair lock before this row-level ExchangeRate lock.
 */
export function exchangeRateAdvisoryLockKey(tenantId: string, exchangeRateId: string): string {
  return `${EXCHANGE_RATE_LOCK_NAMESPACE}:${tenantId}:${exchangeRateId}`;
}

/**
 * Direction-agnostic lock key for serializing DIRECT-first selection with rate creation.
 */
export function exchangeRatePairAdvisoryLockKey(
  tenantId: string,
  baseCurrency: string,
  quoteCurrency: string,
): string {
  const [firstCurrency, secondCurrency] = [baseCurrency, quoteCurrency].sort();
  return `${EXCHANGE_RATE_PAIR_LOCK_NAMESPACE}:${tenantId}:${firstCurrency}:${secondCurrency}`;
}

/** Serializes one tenant-owned ExchangeRate row for snapshot consumption or mutation. */
export async function acquireExchangeRateLock(
  tx: ExchangeRateLockClient,
  tenantId: string,
  exchangeRateId: string,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${exchangeRateAdvisoryLockKey(tenantId, exchangeRateId)}, 0))`,
  );
}

/** Serializes creation and DIRECT-first selection for one tenant currency pair. */
export async function acquireExchangeRatePairLock(
  tx: ExchangeRateLockClient,
  tenantId: string,
  baseCurrency: string,
  quoteCurrency: string,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${exchangeRatePairAdvisoryLockKey(tenantId, baseCurrency, quoteCurrency)}, 0))`,
  );
}
