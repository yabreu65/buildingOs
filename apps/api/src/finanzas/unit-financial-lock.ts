import { Prisma } from '@prisma/client';

const UNIT_FINANCIAL_LOCK_NAMESPACE = 'buildingos:unit-financial:v1';

/**
 * Serialize mutations that can change FIFO eligibility for one unit.
 *
 * The lock is transaction-scoped and tenant-namespaced so unrelated advisory
 * lock domains cannot collide semantically.
 */
export async function lockUnitFinancialMutations(
  tx: Prisma.TransactionClient,
  tenantId: string,
  unitId: string,
): Promise<void> {
  const lockKey = `${UNIT_FINANCIAL_LOCK_NAMESPACE}:${tenantId}:${unitId}`;
  const lockQuery = Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0)) IS NULL AS acquired
  `;
  await tx.$queryRaw(lockQuery);
}

/**
 * Acquire unit financial locks in deterministic order for bulk mutations.
 */
export async function lockUnitsFinancialMutations(
  tx: Prisma.TransactionClient,
  tenantId: string,
  unitIds: readonly string[],
): Promise<void> {
  for (const unitId of [...new Set(unitIds)].sort()) {
    await lockUnitFinancialMutations(tx, tenantId, unitId);
  }
}
