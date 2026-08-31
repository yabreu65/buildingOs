import { Prisma } from '@prisma/client';

const EXPENSE_LOCK_NAMESPACE = 'buildingos:expense-movement:v1';

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
