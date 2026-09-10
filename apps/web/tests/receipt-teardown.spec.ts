import {
  ReceiptTeardownFailedError,
  ReceiptTeardownTimeoutError,
  teardownPaymentReceipts,
  throwReceiptTeardownFailures,
  type ReceiptTeardownDocument,
  type ReceiptTeardownFixture,
  type ReceiptTeardownOperations,
  type ReceiptTeardownPayment,
} from './e2e/resident/receipt-teardown';

function payment(overrides: Partial<ReceiptTeardownPayment> = {}): ReceiptTeardownPayment {
  return {
    id: 'payment-1',
    status: 'APPROVED',
    receiptStatus: 'READY',
    receiptDocumentId: 'document-1',
    ...overrides,
  };
}

function receipt(overrides: Partial<ReceiptTeardownDocument> = {}): ReceiptTeardownDocument {
  return {
    paymentId: 'payment-1',
    documentId: 'document-1',
    fileId: 'file-1',
    bucket: 'e2e-payments',
    objectKey: 'e2e/payments/receipt-1.pdf',
    objectVersionId: 'version-1',
    ...overrides,
  };
}

function fixture(receiptDocuments: ReceiptTeardownDocument[] = []): ReceiptTeardownFixture {
  return { receiptDocuments };
}

function operations(calls: string[], overrides: Partial<ReceiptTeardownOperations> = {}): ReceiptTeardownOperations {
  return {
    waitForReceipt: async () => receipt(),
    unlinkReceiptDocument: async (candidate) => { calls.push(`unlink:${candidate.documentId}`); },
    restoreReceiptDocument: async (candidate) => { calls.push(`restore:${candidate.documentId}`); },
    writeReceiptCleanupManifest: async (candidate) => { calls.push(`manifest:${candidate.documentId}`); },
    deleteReceiptDocument: async (candidate) => { calls.push(`delete-document:${candidate.documentId}`); },
    deletePaymentAllocations: async (paymentIds) => { calls.push(`allocations:${paymentIds.join(',')}`); },
    deletePayments: async (paymentIds) => { calls.push(`payments:${paymentIds.join(',')}`); },
    ...overrides,
  };
}

describe('receipt teardown helper', () => {
  it('reports a FAILED receipt only after deleting its payment artifacts', async () => {
    const calls: string[] = [];
    const result = await teardownPaymentReceipts(
      fixture(),
      [payment({ id: 'payment-failed', receiptStatus: 'FAILED', receiptDocumentId: null })],
      operations(calls, {
        waitForReceipt: async () => { throw new Error('waitForReceipt must not run for FAILED receipts'); },
      }),
    );

    expect(calls).toEqual(['allocations:payment-failed', 'payments:payment-failed']);
    expect(result.hasPreservedPayments).toBe(false);
    expect(() => throwReceiptTeardownFailures(result.failures)).toThrow(ReceiptTeardownFailedError);
  });

  it('detaches, manifests, and deletes a READY receipt before its payment artifacts', async () => {
    const calls: string[] = [];
    const readyReceipt = receipt();
    const result = await teardownPaymentReceipts(
      fixture([readyReceipt]),
      [payment()],
      operations(calls, { waitForReceipt: async () => readyReceipt }),
    );

    expect(calls).toEqual([
      'unlink:document-1',
      'manifest:document-1',
      'delete-document:document-1',
      'allocations:payment-1',
      'payments:payment-1',
    ]);
    expect(result).toEqual({ hasPreservedPayments: false, failures: [] });
  });

  it('preserves the payment when receipt detachment fails', async () => {
    const calls: string[] = [];
    const detachFailure = new Error('relation update failed');
    const result = await teardownPaymentReceipts(
      fixture([receipt()]),
      [payment()],
      operations(calls, {
        unlinkReceiptDocument: async () => {
          calls.push('unlink');
          throw detachFailure;
        },
      }),
    );

    expect(calls).toEqual(['unlink']);
    expect(result.hasPreservedPayments).toBe(true);
    expect(result.failures).toEqual([detachFailure]);
  });

  it('restores the receipt relation and preserves the payment when document deletion fails', async () => {
    const calls: string[] = [];
    const deleteFailure = new Error('document delete failed');
    const result = await teardownPaymentReceipts(
      fixture([receipt()]),
      [payment()],
      operations(calls, {
        deleteReceiptDocument: async () => {
          calls.push('delete-document');
          throw deleteFailure;
        },
      }),
    );

    expect(calls).toEqual(['unlink:document-1', 'manifest:document-1', 'delete-document', 'restore:document-1']);
    expect(result.hasPreservedPayments).toBe(true);
    expect(result.failures).toEqual([deleteFailure]);
  });

  it('preserves both deletion and restoration failures', async () => {
    const documentDeleteFailure = new Error('document delete failed');
    const restoreFailure = new Error('relation restore failed');
    const result = await teardownPaymentReceipts(
      fixture([receipt()]),
      [payment()],
      operations([], {
        deleteReceiptDocument: async () => { throw documentDeleteFailure; },
        restoreReceiptDocument: async () => { throw restoreFailure; },
      }),
    );

    expect(result.hasPreservedPayments).toBe(true);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toBeInstanceOf(AggregateError);
    expect((result.failures[0] as AggregateError).errors).toEqual([documentDeleteFailure, restoreFailure]);
  });

  it('preserves payment artifacts when receipt readiness times out', async () => {
    const calls: string[] = [];
    const pendingPayment = payment({ receiptStatus: 'PENDING', receiptDocumentId: null });
    const result = await teardownPaymentReceipts(
      fixture(),
      [pendingPayment],
      operations(calls, {
        waitForReceipt: async (candidate) => { throw new ReceiptTeardownTimeoutError(candidate.id); },
      }),
    );

    expect(calls).toEqual([]);
    expect(result.hasPreservedPayments).toBe(true);
    expect(result.failures[0]).toBeInstanceOf(ReceiptTeardownTimeoutError);
  });

  it('is idempotent after a successful document teardown', async () => {
    const calls: string[] = [];
    const teardownFixture = fixture([receipt()]);
    const cleanup = operations(calls);

    await teardownPaymentReceipts(teardownFixture, [payment()], cleanup);
    await teardownPaymentReceipts(teardownFixture, [], cleanup);

    expect(teardownFixture.receiptDocuments).toEqual([]);
    expect(calls).toEqual([
      'unlink:document-1',
      'manifest:document-1',
      'delete-document:document-1',
      'allocations:payment-1',
      'payments:payment-1',
    ]);
  });

  it('retries a failed receipt deletion with the retained fixture document', async () => {
    const calls: string[] = [];
    const teardownFixture = fixture([receipt()]);
    let attempt = 0;
    const cleanup = operations(calls, {
      deleteReceiptDocument: async (candidate) => {
        calls.push(`delete-document:${candidate.documentId}`);
        attempt += 1;
        if (attempt === 1) {
          throw new Error('transient storage error');
        }
      },
    });

    const firstResult = await teardownPaymentReceipts(teardownFixture, [payment()], cleanup);
    const retryResult = await teardownPaymentReceipts(teardownFixture, [payment()], cleanup);

    expect(firstResult.hasPreservedPayments).toBe(true);
    expect(retryResult).toEqual({ hasPreservedPayments: false, failures: [] });
    expect(teardownFixture.receiptDocuments).toEqual([]);
    expect(calls).toContain('payments:payment-1');
  });

  it('does not touch unrelated fixture receipts', async () => {
    const calls: string[] = [];
    const unrelatedReceipt = receipt({ paymentId: 'payment-unrelated', documentId: 'document-unrelated' });
    const teardownFixture = fixture([receipt(), unrelatedReceipt]);

    await teardownPaymentReceipts(teardownFixture, [payment()], operations(calls));

    expect(calls).not.toContain('unlink:document-unrelated');
    expect(teardownFixture.receiptDocuments).toEqual([unrelatedReceipt]);
  });

  it('does not touch a receipt whose document is no longer owned by the payment', async () => {
    const calls: string[] = [];
    const unownedReceipt = receipt({ documentId: 'document-reassigned' });
    const teardownFixture = fixture([unownedReceipt]);

    await teardownPaymentReceipts(
      teardownFixture,
      [payment({ status: 'SUBMITTED' })],
      operations(calls),
    );

    expect(calls).toEqual(['allocations:payment-1', 'payments:payment-1']);
    expect(teardownFixture.receiptDocuments).toEqual([unownedReceipt]);
  });
});
