import { Prisma } from '@prisma/client';

/**
 * Locks compartidos del módulo Finanzas (FIN-02/FIN-03).
 *
 * Fund lock: serializa mutaciones de balance de un Fund (advisory xact lock).
 * Income lock: serializa plan de aplicaciones vs void de un Income.
 *
 * Ambos son transaction-scoped (se liberan al commit/rollback) y versionados.
 */

const FUND_LOCK_TAG = 'buildingos_fund_lock_v1';
const INCOME_LOCK_TAG = 'buildingos_income_lock_v1';

export function fundAdvisoryLockKey(tenantId: string, fundId: string): string {
  return `${FUND_LOCK_TAG}:${tenantId}:${fundId}`;
}

export function incomeAdvisoryLockKey(tenantId: string, incomeId: string): string {
  return `${INCOME_LOCK_TAG}:${tenantId}:${incomeId}`;
}

export async function acquireFundLock(
  tx: Prisma.TransactionClient,
  tenantId: string,
  fundId: string,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${fundAdvisoryLockKey(tenantId, fundId)}, 0))`,
  );
}

export async function acquireIncomeLock(
  tx: Prisma.TransactionClient,
  tenantId: string,
  incomeId: string,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${incomeAdvisoryLockKey(tenantId, incomeId)}, 0))`,
  );
}
