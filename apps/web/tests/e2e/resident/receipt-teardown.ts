export interface ReceiptTeardownPayment {
  readonly id: string;
  readonly reference?: string | null;
  readonly status: string;
  readonly receiptStatus: string;
  readonly receiptDocumentId: string | null;
}

export interface ReceiptTeardownDocument {
  readonly paymentId: string;
  readonly documentId: string;
  readonly fileId: string;
  readonly bucket: string;
  readonly objectKey: string;
  readonly objectVersionId: string;
}

export interface ReceiptTeardownFixture {
  receiptDocuments: ReceiptTeardownDocument[];
}

export interface ReceiptTeardownOperations {
  readonly waitForReceipt: (payment: ReceiptTeardownPayment) => Promise<ReceiptTeardownDocument>;
  readonly unlinkReceiptDocument: (receipt: ReceiptTeardownDocument) => Promise<void>;
  readonly restoreReceiptDocument: (receipt: ReceiptTeardownDocument) => Promise<void>;
  readonly writeReceiptCleanupManifest: (receipt: ReceiptTeardownDocument) => Promise<void>;
  readonly deleteReceiptDocument: (receipt: ReceiptTeardownDocument) => Promise<void>;
  readonly deletePaymentAllocations: (paymentIds: string[]) => Promise<void>;
  readonly deletePayments: (paymentIds: string[]) => Promise<void>;
}

export interface ReceiptTeardownResult {
  readonly hasPreservedPayments: boolean;
  readonly failures: unknown[];
}

export class ReceiptTeardownFailedError extends Error {
  constructor(paymentId: string) {
    super(`E2E payment ${paymentId} receipt generation failed`);
    this.name = 'ReceiptTeardownFailedError';
  }
}

export class ReceiptTeardownTimeoutError extends Error {
  constructor(paymentId: string, cause?: unknown) {
    super(`Timed out waiting for receipt cleanup readiness for payment ${paymentId}`, { cause });
    this.name = 'ReceiptTeardownTimeoutError';
  }
}

function isPaymentAwaitingReceipt(payment: ReceiptTeardownPayment): boolean {
  return payment.status === 'APPROVED' || payment.status === 'RECONCILED';
}

function receiptIsOwnedByPayment(
  receipt: ReceiptTeardownDocument,
  payment: ReceiptTeardownPayment | undefined,
): boolean {
  return payment?.receiptStatus === 'READY' && payment.receiptDocumentId === receipt.documentId;
}

function retainReceiptDocument(fixture: ReceiptTeardownFixture, receipt: ReceiptTeardownDocument): void {
  const existingReceipt = fixture.receiptDocuments.find((candidate) => candidate.paymentId === receipt.paymentId);
  if (existingReceipt && existingReceipt.documentId !== receipt.documentId) {
    throw new Error(`Payment ${receipt.paymentId} changed receipt ownership during E2E cleanup`);
  }
  if (!existingReceipt) {
    fixture.receiptDocuments.push(receipt);
  }
}

/** Throws accumulated teardown failures after cleanup has finished. */
export function throwReceiptTeardownFailures(failures: unknown[]): void {
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, 'E2E payment receipt cleanup failed');
  }
}

/**
 * Removes receipt-backed payment artifacts without deleting a payment whose
 * receipt could not be safely detached. All I/O is injected so this teardown
 * policy can be unit-tested without Playwright, Prisma, or object storage.
 */
export async function teardownPaymentReceipts(
  fixture: ReceiptTeardownFixture,
  payments: ReceiptTeardownPayment[],
  operations: ReceiptTeardownOperations,
): Promise<ReceiptTeardownResult> {
  const waitedPayments = payments.filter(isPaymentAwaitingReceipt);
  const receiptWaitResults = await Promise.allSettled(
    waitedPayments.map(async (payment) => {
      if (payment.receiptStatus === 'FAILED') {
        throw new ReceiptTeardownFailedError(payment.id);
      }
      return operations.waitForReceipt(payment);
    }),
  );
  const failures: unknown[] = [];
  const preservedPaymentIds = new Set<string>();

  for (const [index, result] of receiptWaitResults.entries()) {
    const payment = waitedPayments[index];
    if (!payment) {
      throw new Error('Receipt cleanup result had no matching payment');
    }
    if (result.status === 'fulfilled') {
      retainReceiptDocument(fixture, result.value);
      continue;
    }

    failures.push(result.reason);
    if (result.reason instanceof ReceiptTeardownTimeoutError) {
      preservedPaymentIds.add(payment.id);
    }
  }

  const paymentsById = new Map(payments.map((payment) => [payment.id, payment]));
  const receipts = fixture.receiptDocuments.filter((receipt) =>
    receiptIsOwnedByPayment(receipt, paymentsById.get(receipt.paymentId)),
  );

  for (const receipt of receipts) {
    if (preservedPaymentIds.has(receipt.paymentId)) {
      continue;
    }

    let unlinked = false;
    try {
      await operations.unlinkReceiptDocument(receipt);
      unlinked = true;
      await operations.writeReceiptCleanupManifest(receipt);
      await operations.deleteReceiptDocument(receipt);
      fixture.receiptDocuments = fixture.receiptDocuments.filter(
        (candidate) => candidate.documentId !== receipt.documentId,
      );
    } catch (deleteFailure: unknown) {
      preservedPaymentIds.add(receipt.paymentId);
      if (!unlinked) {
        failures.push(deleteFailure);
        continue;
      }

      try {
        await operations.restoreReceiptDocument(receipt);
        failures.push(deleteFailure);
      } catch (restoreFailure: unknown) {
        failures.push(
          new AggregateError(
            [deleteFailure, restoreFailure],
            `E2E receipt document ${receipt.documentId} deletion and payment relation restoration both failed`,
          ),
        );
      }
    }
  }

  const paymentIds = payments
    .map((payment) => payment.id)
    .filter((paymentId) => !preservedPaymentIds.has(paymentId));
  if (paymentIds.length > 0) {
    await operations.deletePaymentAllocations(paymentIds);
    await operations.deletePayments(paymentIds);
  }

  return { hasPreservedPayments: preservedPaymentIds.size > 0, failures };
}
