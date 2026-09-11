import { Prisma } from '@prisma/client';

const EXCHANGE_RATE_LOCK_NAMESPACE = 'buildingos:exchange-rate:v1';

export type ExchangeRateLockClient = Pick<Prisma.TransactionClient, '$executeRaw'>;

/**
 * Transaction-scoped lock key for synchronizing ExchangeRate consumers and writers.
 *
 * Lock order for snapshot producers is: existing movement/entity lifecycle lock first,
 * then this ExchangeRate lock. ExchangeRate update/delete paths acquire only this lock.
 */
export function exchangeRateAdvisoryLockKey(tenantId: string, exchangeRateId: string): string {
  return `${EXCHANGE_RATE_LOCK_NAMESPACE}:${tenantId}:${exchangeRateId}`;
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
