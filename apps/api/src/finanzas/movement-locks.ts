import { Prisma } from '@prisma/client';

const EXPENSE_LOCK_NAMESPACE = 'buildingos:expense-movement:v1';
const ADJUSTMENT_LOCK_NAMESPACE = 'buildingos:adjustment-movement:v1';

/**
 * Serialize lifecycle mutations for one Expense.
 *
 * Lifecycle order is always: expense lock, authoritative reads, then writes;
 * no second lifecycle lock is acquired by these paths.
 */
export async function acquireExpenseLock(
  tx: Prisma.TransactionClient,
  tenantId: string,
  expenseId: string,
): Promise<void> {
  const lockKey = `${EXPENSE_LOCK_NAMESPACE}:${tenantId}:${expenseId}`;
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
  );
}

/**
 * Serialize lifecycle mutations for one Adjustment.
 *
 * Lifecycle order is always: adjustment lock, authoritative reads, then writes;
 * no second lifecycle lock is acquired by these paths.
 */
export async function acquireAdjustmentLock(
  tx: Prisma.TransactionClient,
  tenantId: string,
  adjustmentId: string,
): Promise<void> {
  const lockKey = `${ADJUSTMENT_LOCK_NAMESPACE}:${tenantId}:${adjustmentId}`;
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
  );
}
