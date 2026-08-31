import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const PAYMENT_LINKED_DOCUMENT_CONFLICT_MESSAGE = 'El comprobante está asociado a un pago y no puede modificarse.';

function buildPaymentLinkedDocumentLockKey(tenantId: string, fileId: string): string {
  return `payment-linked-document:${tenantId}:${fileId}`;
}

function buildPaymentReceiptLockKey(paymentId: string): string {
  return `payment-receipt:${paymentId}`;
}

function buildReceiptSequenceLockKey(tenantId: string, year: number): string {
  return `payment-receipt-sequence:${tenantId}:${year}`;
}

export async function acquirePaymentLinkedDocumentLock(
  tx: AdvisoryLockTransactionClient,
  tenantId: string,
  fileId: string,
): Promise<void> {
  const lockKey = buildPaymentLinkedDocumentLockKey(tenantId, fileId);
  await runAdvisoryLock(tx, lockKey);
}

export async function throwIfPaymentLinkedDocumentIsMutable(
  tx: AdvisoryLockTransactionClient,
  tenantId: string,
  documentId: string,
  fileId: string,
): Promise<void> {
  await acquirePaymentLinkedDocumentLock(tx, tenantId, fileId);

  const linkedPayment = await tx.payment.findFirst({
    where: {
      tenantId,
      OR: [
        { receiptDocumentId: documentId },
        { proofFileId: fileId },
      ],
    },
    select: { id: true },
  });

  if (linkedPayment) {
    throw new ConflictException(PAYMENT_LINKED_DOCUMENT_CONFLICT_MESSAGE);
  }
}

export async function acquirePaymentReceiptLock(
  tx: AdvisoryLockTransactionClient,
  paymentId: string,
): Promise<void> {
  const lockKey = buildPaymentReceiptLockKey(paymentId);
  await runAdvisoryLock(tx, lockKey);
}

export async function acquireReceiptSequenceLock(
  tx: AdvisoryLockTransactionClient,
  tenantId: string,
  year: number,
): Promise<void> {
  const lockKey = buildReceiptSequenceLockKey(tenantId, year);
  await runAdvisoryLock(tx, lockKey);
}

interface AdvisoryLockTransactionClient {
  $queryRaw: Prisma.TransactionClient['$queryRaw'];
  $executeRaw?: Prisma.TransactionClient['$executeRaw'];
  payment: Pick<Prisma.TransactionClient['payment'], 'findFirst'>;
}

async function runAdvisoryLock(
  tx: AdvisoryLockTransactionClient,
  lockKey: string,
): Promise<void> {
  if (tx.$executeRaw) {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    return;
  }

  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
}
