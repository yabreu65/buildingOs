import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const PAYMENT_LINKED_DOCUMENT_CONFLICT_MESSAGE = 'El comprobante está asociado a un pago y no puede modificarse.';

function buildPaymentLinkedDocumentLockKey(tenantId: string, fileId: string): string {
  return `payment-linked-document:${tenantId}:${fileId}`;
}

function buildPaymentReceiptLockKey(paymentId: string): string {
  return `payment-receipt:${paymentId}`;
}

export async function acquirePaymentLinkedDocumentLock(
  tx: Prisma.TransactionClient,
  tenantId: string,
  fileId: string,
): Promise<void> {
  const lockKey = buildPaymentLinkedDocumentLockKey(tenantId, fileId);
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
}

export async function throwIfPaymentLinkedDocumentIsMutable(
  tx: Prisma.TransactionClient,
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
  tx: Prisma.TransactionClient,
  paymentId: string,
): Promise<void> {
  const lockKey = buildPaymentReceiptLockKey(paymentId);
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
}
