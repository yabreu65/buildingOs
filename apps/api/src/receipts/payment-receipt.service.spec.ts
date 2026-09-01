import { ConflictException } from '@nestjs/common';
import { PaymentReceiptService } from './payment-receipt.service';
import { ReceiptStatus } from '@prisma/client';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

describe('PaymentReceiptService', () => {
  const DEFAULT_BUCKET = 'buildingos-test';
  const RECEIPT_MAX_TEXT_WIDTH = 595 - 72 - 72;
  let transactionQueryRawMock: jest.Mock;
  let insideTransaction = false;
  let defaultPaymentState: Record<string, unknown>;
  const WIN_ANSI_DECODE_MAP: Record<number, string> = {
    0x80: '€',
    0x82: '‚',
    0x83: 'ƒ',
    0x84: '„',
    0x85: '…',
    0x86: '†',
    0x87: '‡',
    0x88: 'ˆ',
    0x89: '‰',
    0x8a: 'Š',
    0x8b: '‹',
    0x8c: 'Œ',
    0x8e: 'Ž',
    0x91: '‘',
    0x92: '’',
    0x93: '“',
    0x94: '”',
    0x95: '•',
    0x96: '–',
    0x97: '—',
    0x98: '˜',
    0x99: '™',
    0x9a: 'š',
    0x9b: '›',
    0x9c: 'œ',
    0x9e: 'ž',
    0x9f: 'Ÿ',
  };

  const prisma = {
    payment: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    document: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    file: {
      create: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    tenant: {
      findUnique: jest.fn(),
    },
    paymentAuditLog: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    receiptSequence: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    user: {
      findUnique: jest.fn(),
    },
  };
  const minio = {
    getDefaultBucket: jest.fn(() => DEFAULT_BUCKET),
    uploadBuffer: jest.fn(),
    uploadBufferIfAbsent: jest.fn(),
    objectExists: jest.fn(),
    statObject: jest.fn(),
    getObjectBuffer: jest.fn(),
    presignDownload: jest.fn(),
    deleteObject: jest.fn(),
  };
  const notificationsService = {
    createNotification: jest.fn(),
  };

  const service = new PaymentReceiptService(
    prisma as never,
    minio as never,
    notificationsService as never,
  );

  function extractPdfTextLines(buffer: Buffer): string[] {
    const pdfText = buffer.toString('latin1');
    return Array.from(pdfText.matchAll(/\(([^()]*)\) Tj/g)).map((match) =>
      match[1]
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\'),
    );
  }

  function extractPdfContentStreams(buffer: Buffer): string[] {
    const pdfText = buffer.toString('latin1');
    return Array.from(pdfText.matchAll(/stream\n([\s\S]*?)\nendstream/g)).map(
      (match) => match[1],
    );
  }

  function decodeWinAnsiText(text: string): string {
    return Array.from(text, (character) => {
      const code = character.charCodeAt(0);
      return WIN_ANSI_DECODE_MAP[code] ?? character;
    }).join('');
  }

  function extractDecodedPdfTextLines(buffer: Buffer): string[] {
    return extractPdfTextLines(buffer).map(decodeWinAnsiText);
  }

  function measureReceiptTextWidth(text: string): number {
    const widths: Record<string, number> = {
      ' ': 2.5,
      '.': 2.5,
      ',': 2.5,
      ':': 2.5,
      ';': 2.5,
      '!': 2.5,
      '?': 4.5,
      '|': 2.5,
      'i': 2.75,
      'l': 2.75,
      'I': 3,
      'j': 2.75,
      't': 3.5,
      'f': 3.5,
      'r': 3.5,
      's': 4.25,
      'a': 4.5,
      'c': 4.5,
      'e': 4.5,
      'o': 4.5,
      'n': 4.5,
      'u': 4.5,
      'v': 4.5,
      'x': 4.5,
      'y': 4.5,
      'k': 4.75,
      'd': 4.75,
      'g': 4.75,
      'h': 4.75,
      'b': 4.75,
      'p': 4.75,
      'm': 7.25,
      'w': 7.25,
      'M': 8.5,
      'W': 8.5,
      '0': 5,
      '1': 5,
      '2': 5,
      '3': 5,
      '4': 5,
      '5': 5,
      '6': 5,
      '7': 5,
      '8': 5,
      '9': 5,
      '-': 3.5,
      '/': 3.5,
      '(': 3.5,
      ')': 3.5,
      '%': 7,
      'Ñ': 7,
      'Á': 6,
      'É': 6,
      'Í': 6,
      'Ó': 6,
      'Ú': 6,
      'Ü': 6,
      'ñ': 4.75,
      'á': 4.5,
      'é': 4.5,
      'í': 4.5,
      'ó': 4.5,
      'ú': 4.5,
      'ü': 4.5,
    };

    let width = 0;
    for (const character of text) {
      if (widths[character] !== undefined) {
        width += widths[character];
      } else if (character.toUpperCase() === character && character.toLowerCase() !== character.toUpperCase()) {
        width += 6;
      } else {
        width += 5;
      }
    }

    return width;
  }

  function expectPdfTextWithinWidth(lines: string[]) {
    for (const line of lines) {
      if (!line) continue;
      expect(measureReceiptTextWidth(line)).toBeLessThanOrEqual(RECEIPT_MAX_TEXT_WIDTH);
    }
  }

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    insideTransaction = false;
    minio.getDefaultBucket.mockReturnValue(DEFAULT_BUCKET);
    minio.uploadBuffer.mockImplementation(async () => {
      expect(insideTransaction).toBe(false);
    });
    minio.uploadBufferIfAbsent.mockImplementation(async (...args: unknown[]) => {
      await minio.uploadBuffer(...args);
      return true;
    });
    minio.presignDownload.mockImplementation(async () => {
      expect(insideTransaction).toBe(false);
      return 'https://download.example/receipt.pdf';
    });
    minio.objectExists.mockResolvedValue(false);
    minio.statObject.mockImplementation(async () => {
      const lastUpload = minio.uploadBuffer.mock.calls.at(-1)?.[2];
      return { size: Buffer.isBuffer(lastUpload) ? lastUpload.length : 1 };
    });
    minio.getObjectBuffer.mockImplementation(async () => {
      const lastUpload = minio.uploadBuffer.mock.calls.at(-1)?.[2];
      return Buffer.isBuffer(lastUpload) ? lastUpload : Buffer.from('existing-receipt');
    });
    notificationsService.createNotification.mockImplementation(async () => {
      expect(insideTransaction).toBe(false);
      return {};
    });
    transactionQueryRawMock = jest.fn().mockResolvedValue([
      { now: new Date('2026-08-31T00:00:00.000Z') },
    ]);
    prisma.$queryRaw.mockImplementation(transactionQueryRawMock);
    prisma.$transaction.mockImplementation(async (callback: (tx: never) => Promise<unknown>) => {
      const tx = {
        file: prisma.file,
        document: prisma.document,
        payment: prisma.payment,
        paymentAuditLog: prisma.paymentAuditLog,
        tenant: prisma.tenant,
        user: prisma.user,
        receiptSequence: prisma.receiptSequence,
        $queryRaw: transactionQueryRawMock,
      } as never;
      insideTransaction = true;
      try {
        return await callback(tx);
      } finally {
        insideTransaction = false;
      }
    });
    defaultPaymentState = {
      id: 'payment-1',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      unitId: 'unit-1',
      amount: 4050000,
      currency: "ARS",
      method: "TRANSFER",
      status: "APPROVED",
      canceledAt: null,
      receiptStatus: ReceiptStatus.PENDING,
      createdByUserId: "resident-1",
      approvedByUserId: "admin-1",
      approvedAt: "2026-07-24T12:00:00.000Z",
      reference: "TRX-001",
      paymentAllocations: [
        {
          chargeId: "charge-1",
          amount: 4050000,
          charge: {
            period: "2025-10",
            concept: "Condominio ordinario 2025-10",
            expensePeriod: { year: 2025, month: 10 },
          },
        },
      ],
      unit: { label: 'TN-01-01' },
      building: { name: 'Complejo Horizonte' },
       receiptDocumentId: null,
       receiptNumber: null,
       receiptSnapshot: null,
       receiptSnapshotVersion: null,
       receiptSnapshotHash: null,
       receiptSnapshotCreatedAt: null,
       receiptGenerationToken: null,
       receiptGenerationLeaseUntil: null,
      };
    prisma.payment.findUnique.mockResolvedValue(defaultPaymentState as never);
    prisma.payment.findFirst.mockImplementation((...args: unknown[]) =>
      prisma.payment.findUnique(...(args as Parameters<typeof prisma.payment.findUnique>)),
    );
    prisma.document.findFirst.mockImplementation((...args: unknown[]) =>
      prisma.document.findUnique(...(args as Parameters<typeof prisma.document.findUnique>)),
    );
    prisma.tenant.findUnique.mockResolvedValue({ name: 'Complejo Horizonte', brandName: null } as never);
    prisma.user.findUnique.mockResolvedValue({ name: 'Admin' } as never);
    prisma.receiptSequence.findUnique.mockResolvedValue(null);
    prisma.receiptSequence.create.mockResolvedValue({ id: 'sequence-1', lastNumber: 0 } as never);
    prisma.receiptSequence.update.mockResolvedValue({ id: 'sequence-1' } as never);
    prisma.file.create.mockResolvedValue({ id: 'file-1' } as never);
    prisma.file.findFirst.mockResolvedValue(null);
    prisma.file.updateMany.mockResolvedValue({ count: 1 });
    prisma.document.create.mockResolvedValue({ id: 'document-1', file: { bucket: DEFAULT_BUCKET, objectKey: 'object-1' } } as never);
    prisma.payment.update.mockImplementation(async ({ data }) => {
      const latestFind = prisma.payment.findUnique.mock.results.at(-1);
      const current = latestFind?.type === 'return'
        ? await latestFind.value
        : defaultPaymentState;
      if (current && typeof current === 'object') {
        Object.assign(current, data);
      }
      return current as never;
    });
    prisma.payment.updateMany.mockImplementation(async ({ data }) => {
      const latestFind = prisma.payment.findUnique.mock.results.at(-1);
      const current = latestFind?.type === 'return'
        ? await latestFind.value
        : defaultPaymentState;
      if (current && typeof current === 'object') {
        Object.assign(current, data);
      }
      return { count: 1 };
    });
    prisma.paymentAuditLog.create.mockResolvedValue({} as never);
    prisma.paymentAuditLog.findFirst.mockResolvedValue(null);
    notificationsService.createNotification.mockResolvedValue({} as never);
    minio.presignDownload.mockResolvedValue('https://download.example/receipt.pdf');
  });

  function canonicalReceiptKey(receiptNumber = 'R-COMPLE-2026-000001'): string {
    return `tenant/tenant-1/payments/payment-1/receipts/${receiptNumber}.pdf`;
  }

  function readyReceiptPayment(overrides: Record<string, unknown> = {}): unknown {
    return {
      id: 'payment-1',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      unitId: 'unit-1',
      amount: 4050000,
      currency: 'ARS',
      method: 'TRANSFER',
      status: 'APPROVED',
      canceledAt: null,
      receiptStatus: ReceiptStatus.READY,
      receiptNumber: 'R-COMPLE-2026-000001',
      receiptDocumentId: 'document-1',
      createdByUserId: 'resident-1',
      approvedByUserId: 'admin-1',
      approvedAt: '2026-07-24T12:00:00.000Z',
      reference: 'TRX-001',
      paymentAllocations: [],
      unit: { label: 'TN-01-01' },
      building: { name: 'Complejo Horizonte' },
      ...overrides,
    };
  }

  function receiptDocument(fileOverrides: Record<string, unknown> = {}): unknown {
    return {
      id: 'document-1',
      tenantId: 'tenant-1',
      category: 'RECEIPT',
      buildingId: 'building-1',
      unitId: 'unit-1',
      file: {
        id: 'file-1',
        tenantId: 'tenant-1',
        bucket: DEFAULT_BUCKET,
        objectKey: canonicalReceiptKey(),
        mimeType: 'application/pdf',
        size: 123,
        checksum: null,
        ...fileOverrides,
      },
    };
  }

  function configureExistingReadyReceipt(
    paymentOverrides: Record<string, unknown> = {},
    fileOverrides: Record<string, unknown> = {},
  ): void {
    prisma.payment.findUnique.mockResolvedValue(
      readyReceiptPayment(paymentOverrides) as never,
    );
    prisma.document.findUnique.mockResolvedValue(
      receiptDocument(fileOverrides) as never,
    );
    prisma.paymentAuditLog.findFirst.mockResolvedValue({ id: 'audit-1' } as never);
  }

  it('uses the configured bucket when generating a new receipt', async () => {
    const result = await service.ensureReceiptForPayment('tenant-1', 'payment-1');
    const uploadedBuffer = minio.uploadBuffer.mock.calls[0][2] as Buffer;
    const tmpReceiptPath = '/tmp/buildingos-payment-receipt-test.pdf';

    expect(minio.uploadBuffer).toHaveBeenCalledWith(
      DEFAULT_BUCKET,
      expect.stringContaining('/receipts/R-'),
      expect.any(Buffer),
      'application/pdf',
    );
    expect(Buffer.isBuffer(uploadedBuffer)).toBe(true);
    expect(uploadedBuffer.length).toBeGreaterThan(0);
    expect(uploadedBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(uploadedBuffer.includes(Buffer.from('%%EOF'))).toBe(true);
    const pdfText = uploadedBuffer.toString('latin1');
    const normalizedPdfText = pdfText.replace(/\u00a0/g, ' ');
    expect(normalizedPdfText).toContain('Complejo Horizonte');
    expect(normalizedPdfText).not.toContain('BuildingOS -');
    expect(normalizedPdfText).toContain('Emitido por la Administración del Complejo Horizonte');
    expect(normalizedPdfText).not.toContain('endpoint protegido');
    expect(normalizedPdfText).not.toContain('Documento generado por BuildingOS');
    expect(normalizedPdfText).toContain('Número de recibo');
    expect(normalizedPdfText).toContain('Método');
    expect(normalizedPdfText).toContain('Aplicación del pago');
    expect(normalizedPdfText).toContain('Período aplicado: 2025-10');
    expect(normalizedPdfText).toContain('2025-10 - Condominio ordinario 2025-10 - ARS 40.500,00');
    expect(normalizedPdfText).toContain('Página 1 de 1');
    expect(normalizedPdfText).not.toContain('œ');
    expect(normalizedPdfText).not.toContain('Ø');
    expect(normalizedPdfText).not.toContain('¢');
    expect(normalizedPdfText).toContain('ARS 40.500,00');
    writeFileSync(tmpReceiptPath, uploadedBuffer);
    expect(execFileSync('file', [tmpReceiptPath], { encoding: 'utf8' })).toContain('PDF document');
    const pdfInfo = spawnSync('pdfinfo', [tmpReceiptPath], { encoding: 'utf8' });
    if (!pdfInfo.error || (pdfInfo.error as NodeJS.ErrnoException).code !== 'ENOENT') {
      expect(pdfInfo.status).toBe(0);
      expect(pdfInfo.stdout).toContain('Pages:');
    }
     expect(prisma.file.create).toHaveBeenCalledWith(expect.objectContaining({
       data: expect.objectContaining({
         bucket: DEFAULT_BUCKET,
         originalName: expect.stringMatching(/\.pdf$/),
         mimeType: 'application/pdf',
         size: uploadedBuffer.length,
       }),
    }));
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(transactionQueryRawMock).toHaveBeenCalledTimes(5);
     expect(prisma.payment.updateMany).toHaveBeenCalledWith(
       expect.objectContaining({
         data: expect.objectContaining({
           receiptStatus: ReceiptStatus.READY,
            receiptGeneratedAt: new Date('2026-08-31T00:00:00.000Z'),
            receiptError: null,
          }),
         }),
       );
     expect(defaultPaymentState.receiptGeneratedAt).toEqual(
       new Date('2026-08-31T00:00:00.000Z'),
     );
    expect(prisma.paymentAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentId: 'payment-1',
        action: 'RECEIPT_GENERATED',
      }),
    });
    expect(minio.presignDownload).toHaveBeenCalledWith(
      DEFAULT_BUCKET,
      expect.stringContaining('/receipts/R-'),
      3600,
    );
    expect(result?.fileKey).toContain('/receipts/R-');
  });

  it('reuses the reserved receipt number after an upload failure', async () => {
    let paymentState = {
      id: 'payment-1',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      unitId: 'unit-1',
      amount: 4050000,
      currency: "ARS",
      method: "TRANSFER",
      createdByUserId: "resident-1",
      approvedByUserId: "admin-1",
      status: "APPROVED",
      canceledAt: null,
      approvedAt: "2026-07-24T12:00:00.000Z",
      reference: "TRX-001",
      paymentAllocations: [
        {
          chargeId: "charge-1",
          amount: 4050000,
          charge: {
            period: "2025-10",
            concept: "Condominio ordinario 2025-10",
            expensePeriod: { year: 2025, month: 10 },
          },
        },
      ],
      unit: { label: 'TN-01-01' },
      building: { name: 'Complejo Horizonte' },
      receiptDocumentId: null,
      receiptNumber: null,
      receiptStatus: ReceiptStatus.PENDING,
      receiptError: null,
    } as never;

    prisma.payment.findUnique.mockImplementation(async () => paymentState as never);
    prisma.payment.update.mockImplementation(async ({ data }) => {
      paymentState = {
        ...paymentState,
        ...data,
      } as never;
      return paymentState as never;
    });
    minio.uploadBuffer.mockRejectedValueOnce(new Error('upload failed'));

    await expect(service.ensureReceiptForPayment('tenant-1', 'payment-1')).resolves.toBeNull();
    expect(paymentState.receiptNumber).toBe('R-COMPLE-2026-000001');
    expect(paymentState.receiptStatus).toBe(ReceiptStatus.FAILED);
    expect(prisma.receiptSequence.create).toHaveBeenCalledTimes(1);
    expect(prisma.receiptSequence.update).toHaveBeenCalledTimes(1);
    expect(transactionQueryRawMock).toHaveBeenCalledTimes(5);
    expect(minio.deleteObject).not.toHaveBeenCalled();

    minio.uploadBuffer.mockResolvedValueOnce(undefined);

    const retryResult = await service.ensureReceiptForPayment('tenant-1', 'payment-1');

    expect(retryResult?.receiptNumber).toBe('R-COMPLE-2026-000001');
    expect(retryResult?.fileKey).toBe('tenant/tenant-1/payments/payment-1/receipts/R-COMPLE-2026-000001.pdf');
    expect(prisma.receiptSequence.create).toHaveBeenCalledTimes(1);
    expect(prisma.receiptSequence.update).toHaveBeenCalledTimes(1);
     expect(prisma.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
       data: expect.objectContaining({
         receiptStatus: ReceiptStatus.READY,
       }),
    }));
  });

  it("marks generation failed while retaining an uploaded object for recovery", async () => {
    prisma.document.create.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(service.ensureReceiptForPayment('tenant-1', 'payment-1')).resolves.toBeNull();

    expect(minio.uploadBuffer).toHaveBeenCalled();
    expect(minio.deleteObject).not.toHaveBeenCalled();
     expect(prisma.payment.updateMany).toHaveBeenCalledWith(
       expect.objectContaining({
         data: expect.objectContaining({
           receiptStatus: ReceiptStatus.FAILED,
         }),
        }),
      );
  });

  it('marks receipt generation failed under the receipt lock only when still pending', async () => {
    const markFailed = Reflect.get(service, 'markReceiptGenerationFailedIfNeeded') as (
      tenantId: string,
      paymentId: string,
      errorMessage: string,
    ) => Promise<void>;

    prisma.payment.findUnique.mockResolvedValueOnce({
      receiptStatus: ReceiptStatus.PENDING,
      receiptDocumentId: null,
      receiptGenerationToken: null,
      receiptGenerationLeaseUntil: null,
    } as never);

    await markFailed.call(service, 'tenant-1', 'payment-1', 'boom');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transactionQueryRawMock).toHaveBeenCalledTimes(2);
    expect(prisma.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'payment-1', tenantId: 'tenant-1' }),
      data: expect.objectContaining({
        receiptStatus: ReceiptStatus.FAILED,
        receiptError: 'boom',
      }),
    }));
  });

  it('does not downgrade READY or confirmed receipts when marking failed', async () => {
    const markFailed = Reflect.get(service, 'markReceiptGenerationFailedIfNeeded') as (
      tenantId: string,
      paymentId: string,
      errorMessage: string,
    ) => Promise<void>;

    prisma.payment.findUnique.mockResolvedValueOnce({
      receiptStatus: ReceiptStatus.READY,
      receiptDocumentId: null,
      receiptGenerationToken: null,
      receiptGenerationLeaseUntil: null,
    } as never);

    await markFailed.call(service, 'tenant-1', 'payment-1', 'presign failed');

    expect(prisma.payment.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        receiptStatus: ReceiptStatus.FAILED,
      }),
    }));

    prisma.payment.findUnique.mockResolvedValueOnce({
      receiptStatus: ReceiptStatus.PENDING,
      receiptDocumentId: 'document-1',
      receiptGenerationToken: null,
      receiptGenerationLeaseUntil: null,
    } as never);

    await markFailed.call(service, 'tenant-1', 'payment-1', 'notify failed');

     expect(prisma.payment.updateMany).toHaveBeenCalledWith(
       expect.objectContaining({
         data: expect.objectContaining({
           receiptStatus: ReceiptStatus.FAILED,
         }),
        }),
      );
  });

  it('keeps READY receipts stable when presign fails after confirmation', async () => {
    let paymentState = {
      id: 'payment-1',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      unitId: 'unit-1',
      amount: 4050000,
      currency: "ARS",
      method: "TRANSFER",
      createdByUserId: "resident-1",
      approvedByUserId: "admin-1",
      status: "APPROVED",
      canceledAt: null,
      approvedAt: "2026-07-24T12:00:00.000Z",
      reference: "TRX-001",
      paymentAllocations: [
        {
          chargeId: "charge-1",
          amount: 4050000,
          charge: {
            period: "2025-10",
            concept: "Condominio ordinario 2025-10",
            expensePeriod: { year: 2025, month: 10 },
          },
        },
      ],
      unit: { label: 'TN-01-01' },
      building: { name: 'Complejo Horizonte' },
      receiptDocumentId: null,
      receiptNumber: null,
      receiptStatus: ReceiptStatus.PENDING,
      receiptError: null,
    } as never;

    prisma.payment.findUnique.mockImplementation(async () => paymentState as never);
    prisma.payment.update.mockImplementation(async ({ data }) => {
      paymentState = {
        ...paymentState,
        ...data,
      } as never;
      return paymentState as never;
    });
    minio.presignDownload.mockRejectedValueOnce(new Error('presign failed'));

    await expect(service.ensureReceiptForPayment('tenant-1', 'payment-1')).resolves.toBeNull();

    expect(prisma.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        receiptStatus: ReceiptStatus.READY,
      }),
    }));
    expect(prisma.payment.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        receiptStatus: ReceiptStatus.FAILED,
      }),
    }));
    expect(paymentState.receiptStatus).toBe(ReceiptStatus.READY);
    expect(transactionQueryRawMock).toHaveBeenCalledTimes(7);
  });

  it('releases a failed READY generation lease without changing published receipt state', async () => {
    const receiptGeneratedAt = new Date('2026-08-31T00:01:00.000Z');
    const receiptSnapshotCreatedAt = new Date('2026-08-31T00:00:00.000Z');
    const readyPayment = readyReceiptPayment({
      receiptGeneratedAt,
      receiptError: 'existing-ready-error',
    }) as Record<string, unknown>;
    const createSnapshot = Reflect.get(service, 'createReceiptSnapshot') as (
      payment: unknown,
      receiptNumber: string,
      tenantDisplayName: string,
      approvedByUserName: string,
      createdAt: Date,
    ) => unknown;
    const receiptSnapshot = createSnapshot.call(
      service,
      readyPayment,
      'R-COMPLE-2026-000001',
      'Complejo Horizonte',
      'Admin',
      receiptSnapshotCreatedAt,
    );
    const hashSnapshot = Reflect.get(service, 'hashReceiptSnapshot') as (
      snapshotValue: unknown,
    ) => string;
    Object.assign(readyPayment, {
      receiptSnapshot,
      receiptSnapshotVersion: 'PAYMENT_RECEIPT_V1',
      receiptSnapshotHash: hashSnapshot.call(service, receiptSnapshot),
      receiptSnapshotCreatedAt,
      receiptGenerationToken: null,
      receiptGenerationLeaseUntil: null,
    });
    prisma.payment.findUnique.mockResolvedValue(readyPayment as never);
    prisma.document.findUnique.mockResolvedValue(
      receiptDocument({ checksum: 'published-checksum' }) as never,
    );
    prisma.paymentAuditLog.findFirst.mockResolvedValue({ id: 'audit-1' } as never);
    minio.objectExists.mockRejectedValueOnce(new Error('storage validation failed'));

    await expect(
      service.ensureReceiptForPayment('tenant-1', 'payment-1'),
    ).resolves.toBeNull();

    expect(readyPayment.receiptStatus).toBe(ReceiptStatus.READY);
    expect(readyPayment.receiptNumber).toBe('R-COMPLE-2026-000001');
    expect(readyPayment.receiptGeneratedAt).toBe(receiptGeneratedAt);
    expect(readyPayment.receiptSnapshot).toEqual(receiptSnapshot);
    expect(readyPayment.receiptSnapshotHash).toBe(
      hashSnapshot.call(service, receiptSnapshot),
    );
    expect(readyPayment.receiptSnapshotCreatedAt).toBe(receiptSnapshotCreatedAt);
    expect(readyPayment.receiptDocumentId).toBe('document-1');
    expect(readyPayment.receiptError).toBe('existing-ready-error');
    expect(readyPayment.receiptGenerationToken).toBeNull();
    expect(readyPayment.receiptGenerationLeaseUntil).toBeNull();
    expect(prisma.payment.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'payment-1',
        tenantId: 'tenant-1',
        receiptGenerationToken: expect.any(String),
        receiptGenerationLeaseUntil: {
          gt: new Date('2026-08-31T00:00:00.000Z'),
        },
      },
      data: {
        receiptGenerationToken: null,
        receiptGenerationLeaseUntil: null,
      },
    });

    const retryResult = await service.ensureReceiptForPayment(
      'tenant-1',
      'payment-1',
    );

    expect(retryResult?.receiptNumber).toBe('R-COMPLE-2026-000001');
    expect(readyPayment.receiptStatus).toBe(ReceiptStatus.READY);
    expect(readyPayment.receiptGeneratedAt).toBe(receiptGeneratedAt);
    expect(readyPayment.receiptSnapshot).toEqual(receiptSnapshot);
    expect(readyPayment.receiptDocumentId).toBe('document-1');
  });

  it('keeps READY receipts stable when notification fails after confirmation', async () => {
    notificationsService.createNotification.mockRejectedValueOnce(new Error('notify failed'));

    const result = await service.ensureReceiptForPayment('tenant-1', 'payment-1');

    expect(result?.receiptNumber).toBe('R-COMPLE-2026-000001');
    expect(prisma.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        receiptStatus: ReceiptStatus.READY,
      }),
    }));
    expect(prisma.payment.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        receiptStatus: ReceiptStatus.FAILED,
      }),
    }));
  });

  it('stores a safe error message instead of raw error when receipt generation fails', async () => {
    let paymentState = {
      id: 'payment-1',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      unitId: 'unit-1',
      amount: 4050000,
      currency: "ARS",
      method: "TRANSFER",
      createdByUserId: "resident-1",
      approvedByUserId: "admin-1",
      status: "APPROVED",
      canceledAt: null,
      approvedAt: "2026-07-24T12:00:00.000Z",
      reference: "TRX-001",
      paymentAllocations: [
        {
          chargeId: "charge-1",
          amount: 4050000,
          charge: {
            period: "2025-10",
            concept: "Condominio ordinario 2025-10",
            expensePeriod: { year: 2025, month: 10 },
          },
        },
      ],
      unit: { label: 'TN-01-01' },
      building: { name: 'Complejo Horizonte' },
      receiptDocumentId: null,
      receiptNumber: null,
      receiptStatus: ReceiptStatus.PENDING,
      receiptError: null,
    } as never;

    prisma.payment.findUnique.mockImplementation(async () => paymentState as never);
    prisma.payment.update.mockImplementation(async ({ data }) => {
      paymentState = { ...paymentState, ...data } as never;
      return paymentState as never;
    });
    minio.uploadBuffer.mockRejectedValueOnce(new Error('Invalid `prisma.paymentAuditLog.create()` invocation'));

    await service.ensureReceiptForPayment('tenant-1', 'payment-1');

    expect(paymentState.receiptStatus).toBe(ReceiptStatus.FAILED);
    expect(paymentState.receiptError).toBe('No pudimos generar el comprobante. Intenta nuevamente más tarde.');
  });

  it('does not notify the receipt owner when excluded from the approval flow', async () => {
    const notifyResidentReceiptReady = Reflect.get(service, 'notifyResidentReceiptReady') as (
      payment: { tenantId: string; createdByUserId: string; amount: number; currency: string; id: string },
      receiptNumber: string,
      receiptUrl: string,
      approvedByUserName: string,
      excludeUserId?: string,
    ) => Promise<void>;

    await notifyResidentReceiptReady(
      {
        tenantId: 'tenant-1',
        createdByUserId: 'resident-1',
        amount: 4050000,
        currency: 'ARS',
        id: 'payment-1',
      },
      'R-2026-001',
      'https://download.example/receipt.pdf',
      'Admin',
      'resident-1',
    );

    expect(notificationsService.createNotification).not.toHaveBeenCalled();
  });

  it('encodes WinAnsi punctuation and falls back safely for unsupported characters', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      name: 'Consorcio “Central”',
      brandName: 'Administración “Central” — Horizonte €',
    } as never);
    prisma.user.findUnique.mockResolvedValue({ name: "Niñez" } as never);
    prisma.payment.findUnique.mockResolvedValue({
      id: "payment-1",
      tenantId: "tenant-1",
      buildingId: "building-1",
      unitId: "unit-1",
      amount: 4050000,
      currency: "ARS",
      method: "TRANSFER",
      createdByUserId: "resident-1",
      approvedByUserId: "admin-1",
      status: "APPROVED",
      canceledAt: null,
      approvedAt: "2026-07-24T12:00:00.000Z",
      reference: "Referencia “curva” € 🙂 / validado \\ soporte",
      paymentAllocations: [
        {
          chargeId: "charge-1",
          amount: 4050000,
          charge: {
            period: "2025-10",
            concept: "Condominio – especial…",
            expensePeriod: { year: 2025, month: 10 },
          },
        },
      ],
      unit: { label: 'TN-01-01' },
      building: { name: 'Torre “A”' },
      receiptDocumentId: null,
      receiptNumber: null,
    } as never);

    await service.ensureReceiptForPayment('tenant-1', 'payment-1');

    const uploadedBuffer = minio.uploadBuffer.mock.calls[0][2] as Buffer;
    const decodedPdfText = extractDecodedPdfTextLines(uploadedBuffer).join('\n');

    expect(decodedPdfText).toContain('Administración “Central” — Horizonte €');
    expect(decodedPdfText).toContain('Niñez');
    expect(decodedPdfText).toContain('Referencia “curva” € ? / validado \\ soporte');
    expect(decodedPdfText).toContain('Condominio – especial…');
    expect(decodedPdfText).toContain('Torre “A”');
    expect(decodedPdfText).toContain('Página 1 de 1');
    expect(decodedPdfText).not.toContain('🙂');
    expect(uploadedBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it("escapes parentheses and backslashes in the PDF stream after WinAnsi encoding", async () => {
    prisma.payment.findUnique.mockResolvedValue({
      id: "payment-1",
      tenantId: "tenant-1",
      buildingId: "building-1",
      unitId: "unit-1",
      amount: 4050000,
      currency: "ARS",
      method: "TRANSFER",
      createdByUserId: "resident-1",
      approvedByUserId: "admin-1",
      status: "APPROVED",
      canceledAt: null,
      approvedAt: "2026-07-24T12:00:00.000Z",
      reference: "Pago (confirmado) \\ soporte",
      paymentAllocations: [
        {
          chargeId: "charge-1",
          amount: 4050000,
          charge: {
            period: "2025-10",
            concept: "Condominio ordinario 2025-10",
            expensePeriod: { year: 2025, month: 10 },
          },
        },
      ],
      unit: { label: 'TN-01-01' },
      building: { name: 'Complejo Horizonte' },
      receiptDocumentId: null,
      receiptNumber: null,
    } as never);

    await service.ensureReceiptForPayment('tenant-1', 'payment-1');

    const uploadedBuffer = minio.uploadBuffer.mock.calls[0][2] as Buffer;
    const pdfText = uploadedBuffer.toString('latin1');

    expect(pdfText).toContain('\\(confirmado\\)');
    expect(pdfText).toContain('\\\\ soporte');
    expect(uploadedBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it("fails closed for an existing receipt with a non-canonical bucket or key", async () => {
    prisma.payment.findUnique.mockResolvedValue({
      id: "payment-1",
      tenantId: "tenant-1",
      buildingId: "building-1",
      unitId: "unit-1",
      amount: 12345,
      currency: "ARS",
      method: "TRANSFER",
      createdByUserId: "resident-1",
      approvedByUserId: "admin-1",
      status: "APPROVED",
      canceledAt: null,
      receiptStatus: ReceiptStatus.READY,
      approvedAt: "2026-07-24T12:00:00.000Z",
      reference: "TRX-001",
      paymentAllocations: [],
      unit: { label: 'TN-01-01' },
      building: { name: 'Complejo Horizonte' },
      receiptDocumentId: 'document-1',
      receiptNumber: 'R-HZ-2026-000001',
    } as never);
    prisma.document.findUnique.mockResolvedValueOnce({
      id: "document-1",
      tenantId: "tenant-1",
      category: "RECEIPT",
      buildingId: "building-1",
      unitId: "unit-1",
      file: {
        id: "file-1",
        tenantId: "tenant-1",
        bucket: "tenant-legacy-bucket",
        objectKey: "receipt.pdf",
        mimeType: "application/pdf",
        size: 123,
        checksum: null,
      },
    } as never);
    prisma.paymentAuditLog.findFirst.mockResolvedValueOnce({
      id: "audit-1",
    } as never);
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: 123 });

    await expect(
      service.ensureReceiptForPayment('tenant-1', 'payment-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.document.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'document-1',
        tenantId: 'tenant-1',
      },
      include: {
        file: true,
      },
    });
    expect(minio.presignDownload).not.toHaveBeenCalled();
    expect(minio.uploadBuffer).not.toHaveBeenCalled();
    expect(minio.uploadBufferIfAbsent).not.toHaveBeenCalled();
    expect(prisma.file.create).not.toHaveBeenCalled();
  });

  it("splits long allocation lists across multiple PDF pages", async () => {
    prisma.payment.findUnique.mockResolvedValue({
      id: "payment-1",
      tenantId: "tenant-1",
      buildingId: "building-1",
      unitId: "unit-1",
      amount: 4050000,
      currency: "ARS",
      method: "TRANSFER",
      createdByUserId: "resident-1",
      approvedByUserId: "admin-1",
      status: "APPROVED",
      canceledAt: null,
      approvedAt: "2026-07-24T12:00:00.000Z",
      reference: "TRX-001",
      paymentAllocations: Array.from({ length: 10 }, (_, index) => ({
        chargeId: `charge-${index + 1}`,
        amount: 405000,
        charge: {
          period: `2025-${String(index + 1).padStart(2, '0')}`,
          concept: `Condominio ${index + 1}`,
          expensePeriod: { year: 2025, month: index + 1 },
        },
      })),
      unit: { label: 'TN-01-01' },
      building: { name: 'Complejo Horizonte' },
      receiptDocumentId: null,
      receiptNumber: null,
    } as never);

    await service.ensureReceiptForPayment('tenant-1', 'payment-1');

    const uploadedBuffer = minio.uploadBuffer.mock.calls[0][2] as Buffer;
    const pdfText = uploadedBuffer.toString('latin1');
    const contentStreams = extractPdfContentStreams(uploadedBuffer);
    const pageObjects = pdfText.match(/\/Type \/Page(?!s)/g) || [];

    expect(pageObjects.length).toBe(2);
    expect(contentStreams).toHaveLength(2);
    for (const streamText of contentStreams) {
      expect(streamText).toContain('BT');
      expect(streamText).toContain('ET');
    }
    expect(contentStreams[0]).toContain('14 TL');
    const continuationLeadingIndex = contentStreams[1].indexOf('14 TL');
    const continuationAdvanceIndex = contentStreams[1].indexOf('T*');
    expect(continuationLeadingIndex).toBeGreaterThan(-1);
    expect(continuationLeadingIndex).toBeLessThan(continuationAdvanceIndex);
    expect(pdfText).toContain('Continúa en la siguiente página.');
    expect(pdfText).toContain('Página 1 de 2');
    expect(pdfText).toContain('Página 2 de 2');
  });

  it('wraps long receipt fields and keeps every line within the available width', async () => {
    const longTenantName = 'Consorcio Complejo Residencial Horizonte Torre Norte y Torre Sur con Administración Extendida y Consejo Vecinal';
    const longBuildingName = 'Torre Horizonte A con Hall Principal, Cocheras y SUM del Complejo Residencial Horizonte';
    const longReference = 'TRANSFERENCIA-EXTREMADAMENTE-LARGA-SIN-ESPACIOS-0123456789ABCDEFGHIJKLMN';
    const longConcept = 'Condominio ordinario con descripción extremadamente larga para validar el wrapping del PDF multipágina';

    prisma.payment.findUnique.mockResolvedValue({
      id: "payment-1",
      tenantId: "tenant-1",
      buildingId: "building-1",
      unitId: "unit-1",
      amount: 4050000,
      currency: "ARS",
      method: "TRANSFER",
      createdByUserId: "resident-1",
      approvedByUserId: "admin-1",
      status: "APPROVED",
      canceledAt: null,
      approvedAt: "2026-07-24T12:00:00.000Z",
      reference: longReference,
      paymentAllocations: [{
        chargeId: 'charge-1',
        amount: 4050000,
        charge: {
          period: '2025-10',
          concept: longConcept,
          expensePeriod: { year: 2025, month: 10 },
        },
      }],
      unit: { label: 'TN-01-01-BIS-EXTRA-LARGA' },
      building: { name: longBuildingName },
      receiptDocumentId: null,
      receiptNumber: null,
    } as never);
    prisma.tenant.findUnique.mockResolvedValueOnce({ name: longTenantName, brandName: null } as never);
    prisma.user.findUnique.mockResolvedValueOnce({ name: 'Admin' } as never);

    const result = await service.ensureReceiptForPayment('tenant-1', 'payment-1');
    expect(result?.documentId).toBe('document-1');

    const uploadedBuffer = minio.uploadBuffer.mock.calls[0][2] as Buffer;
    const pdfText = uploadedBuffer.toString('latin1');
    const normalizedPdfText = pdfText.replace(/\u00a0/g, ' ');
    const pdfLines = extractPdfTextLines(uploadedBuffer);
    const wrappedLines = pdfLines.filter((line) => line.length > 0);
    const reconstructedText = wrappedLines.join(' ');

    expect(uploadedBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(reconstructedText).toContain(longBuildingName);
    expect(normalizedPdfText).toContain('Página 1 de 1');
    expect(normalizedPdfText).toContain('Documento generado por la Administración del');
    expect(reconstructedText).toContain(longConcept);
    expect(reconstructedText).toContain(longReference);
    expectPdfTextWithinWidth(wrappedLines);
  });

  it.each([ReceiptStatus.PENDING, ReceiptStatus.FAILED])(
    "recovers a legacy reserved-only %s receipt without reserving another number",
    async (receiptStatus) => {
      Object.assign(defaultPaymentState, {
        receiptStatus,
        receiptNumber: "R-COMPLE-2026-000001",
      });

      const result = await service.ensureReceiptForPayment(
        "tenant-1",
        "payment-1",
      );

      expect(result?.receiptNumber).toBe("R-COMPLE-2026-000001");
      expect(defaultPaymentState.receiptNumber).toBe("R-COMPLE-2026-000001");
      expect(defaultPaymentState.receiptSnapshot).not.toBeNull();
      expect(defaultPaymentState.receiptStatus).toBe(ReceiptStatus.READY);
      expect(prisma.receiptSequence.create).not.toHaveBeenCalled();
      expect(prisma.receiptSequence.update).not.toHaveBeenCalled();
      expect(prisma.file.create).toHaveBeenCalledTimes(1);
      expect(prisma.document.create).toHaveBeenCalledTimes(1);
      expect(prisma.paymentAuditLog.create).toHaveBeenCalledTimes(1);
    },
  );

  it("adopts an orphaned legacy canonical object without regenerating it", async () => {
    Object.assign(defaultPaymentState, {
      receiptStatus: ReceiptStatus.FAILED,
      receiptNumber: "R-COMPLE-2026-000001",
    });
    const legacyPdf = Buffer.from("%PDF-legacy-orphan");
    const lastModified = new Date("2026-08-30T12:00:00.000Z");
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({
      size: legacyPdf.length,
      etag: "legacy-etag",
      lastModified,
      metaData: { "content-type": "application/pdf" },
    });
    minio.getObjectBuffer.mockResolvedValue(legacyPdf);

    const result = await service.ensureReceiptForPayment("tenant-1", "payment-1");

    expect(minio.uploadBuffer).not.toHaveBeenCalled();
    expect(minio.uploadBufferIfAbsent).not.toHaveBeenCalled();
    expect(result?.receiptNumber).toBe("R-COMPLE-2026-000001");
    expect(prisma.receiptSequence.create).not.toHaveBeenCalled();
    expect(prisma.receiptSequence.update).not.toHaveBeenCalled();
    expect(prisma.file.create).toHaveBeenCalledTimes(1);
    expect(prisma.document.create).toHaveBeenCalledTimes(1);
    expect(prisma.paymentAuditLog.create).toHaveBeenCalledTimes(1);
    expect(defaultPaymentState.receiptSnapshot).toBeNull();
    expect(defaultPaymentState.receiptStatus).toBe(ReceiptStatus.READY);
    expect(defaultPaymentState.receiptGeneratedAt).toEqual(lastModified);
  });

  it("atomically takes over an expired orphan recovery claim", async () => {
    const expiredLease = new Date("2026-08-30T23:59:59.000Z");
    const lastModified = new Date("2026-08-30T12:00:00.000Z");
    const orphanPdf = Buffer.from("%PDF-expired-orphan");
    Object.assign(defaultPaymentState, {
      receiptStatus: ReceiptStatus.FAILED,
      receiptNumber: "R-COMPLE-2026-000001",
      receiptGeneratedAt: null,
      receiptGenerationToken: "expired-owner",
      receiptGenerationLeaseUntil: expiredLease,
    });
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({
      size: orphanPdf.length,
      etag: "expired-etag",
      lastModified,
      metaData: { "content-type": "application/pdf" },
    });
    minio.getObjectBuffer.mockResolvedValue(orphanPdf);

    const result = await service.ensureReceiptForPayment("tenant-1", "payment-1");

    expect(result?.receiptNumber).toBe("R-COMPLE-2026-000001");
    expect(minio.uploadBuffer).not.toHaveBeenCalled();
    expect(minio.uploadBufferIfAbsent).not.toHaveBeenCalled();
    expect(defaultPaymentState.receiptGenerationToken).toBeNull();
    expect(defaultPaymentState.receiptGenerationLeaseUntil).toBeNull();
    expect(defaultPaymentState.receiptGeneratedAt).toEqual(lastModified);
    expect(prisma.file.create).toHaveBeenCalledTimes(1);
    expect(prisma.document.create).toHaveBeenCalledTimes(1);
    expect(prisma.paymentAuditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.payment.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          receiptGenerationToken: "expired-owner",
          receiptGenerationLeaseUntil: expiredLease,
        }),
        data: expect.objectContaining({
          receiptGenerationToken: expect.any(String),
          receiptGenerationLeaseUntil: new Date("2026-08-31T00:05:00.000Z"),
        }),
      }),
    );
  });

  it("does not replace an active orphan recovery claim", async () => {
    const activeLease = new Date("2026-08-31T00:05:00.000Z");
    Object.assign(defaultPaymentState, {
      receiptStatus: ReceiptStatus.FAILED,
      receiptNumber: "R-COMPLE-2026-000001",
      receiptGenerationToken: "active-owner",
      receiptGenerationLeaseUntil: activeLease,
    });
    minio.objectExists.mockResolvedValue(true);
    jest.spyOn(service as never, "waitForReceiptGeneration").mockResolvedValue(null);

    await expect(
      service.ensureReceiptForPayment("tenant-1", "payment-1"),
    ).rejects.toMatchObject({
      response: { message: "RECEIPT_GENERATION_IN_PROGRESS" },
    });

    expect(defaultPaymentState.receiptGenerationToken).toBe("active-owner");
    expect(defaultPaymentState.receiptGenerationLeaseUntil).toEqual(activeLease);
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    expect(minio.statObject).not.toHaveBeenCalled();
    expect(minio.getObjectBuffer).not.toHaveBeenCalled();
    expect(prisma.file.create).not.toHaveBeenCalled();
    expect(prisma.document.create).not.toHaveBeenCalled();
    expect(prisma.paymentAuditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ["token without lease", "inconsistent-owner", null],
    ["lease without token", null, new Date("2026-08-30T23:59:59.000Z")],
  ] as const)(
    "fails closed for an inconsistent orphan recovery claim: %s",
    async (_description, token, lease) => {
      Object.assign(defaultPaymentState, {
        receiptStatus: ReceiptStatus.FAILED,
        receiptNumber: "R-COMPLE-2026-000001",
        receiptGenerationToken: token,
        receiptGenerationLeaseUntil: lease,
      });
      minio.objectExists.mockResolvedValue(true);

      await expect(
        service.ensureReceiptForPayment("tenant-1", "payment-1"),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(minio.statObject).not.toHaveBeenCalled();
      expect(minio.getObjectBuffer).not.toHaveBeenCalled();
      expect(prisma.file.create).not.toHaveBeenCalled();
      expect(prisma.document.create).not.toHaveBeenCalled();
      expect(prisma.paymentAuditLog.create).not.toHaveBeenCalled();
      expect(defaultPaymentState.receiptGenerationToken).toBe(token);
      expect(defaultPaymentState.receiptGenerationLeaseUntil).toBe(lease);
    },
  );

  it.each([
    ["token", "stray-owner", new Date("2026-08-30T23:59:59.000Z")],
    ["lease", null, new Date("2026-08-31T00:05:00.000Z")],
  ] as const)(
    "does not reinterpret %s leftovers as reserved-only recovery",
    async (_description, token, lease) => {
      Object.assign(defaultPaymentState, {
        receiptStatus: ReceiptStatus.FAILED,
        receiptNumber: "R-COMPLE-2026-000001",
        receiptGenerationToken: token,
        receiptGenerationLeaseUntil: lease,
      });

      await expect(
        service.ensureReceiptForPayment("tenant-1", "payment-1"),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.receiptSequence.create).not.toHaveBeenCalled();
      expect(prisma.receiptSequence.update).not.toHaveBeenCalled();
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(minio.uploadBuffer).not.toHaveBeenCalled();
      expect(prisma.file.create).not.toHaveBeenCalled();
      expect(prisma.document.create).not.toHaveBeenCalled();
      expect(prisma.paymentAuditLog.create).not.toHaveBeenCalled();
      expect(defaultPaymentState.receiptGenerationToken).toBe(token);
      expect(defaultPaymentState.receiptGenerationLeaseUntil).toBe(lease);
    },
  );

  it("fails closed for an invalid orphaned legacy canonical object", async () => {
    Object.assign(defaultPaymentState, {
      receiptStatus: ReceiptStatus.PENDING,
      receiptNumber: "R-COMPLE-2026-000001",
    });
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({
      size: 17,
      etag: "invalid-etag",
      lastModified: new Date("2026-08-30T12:00:00.000Z"),
      metaData: { "content-type": "application/pdf" },
    });
    minio.getObjectBuffer.mockResolvedValue(Buffer.from("not-a-pdf-object"));

    await expect(
      service.ensureReceiptForPayment("tenant-1", "payment-1"),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(minio.uploadBuffer).not.toHaveBeenCalled();
    expect(minio.uploadBufferIfAbsent).not.toHaveBeenCalled();
    expect(prisma.file.create).not.toHaveBeenCalled();
    expect(prisma.document.create).not.toHaveBeenCalled();
    expect(defaultPaymentState.receiptSnapshot).toBeNull();
    expect(defaultPaymentState.receiptStatus).toBe(ReceiptStatus.FAILED);
  });

  it("fails closed when an orphaned legacy object has a non-PDF MIME type", async () => {
    Object.assign(defaultPaymentState, {
      receiptStatus: ReceiptStatus.FAILED,
      receiptNumber: "R-COMPLE-2026-000001",
    });
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({
      size: 18,
      etag: "invalid-mime-etag",
      lastModified: new Date("2026-08-30T12:00:00.000Z"),
      metaData: { "content-type": "text/plain" },
    });
    minio.getObjectBuffer.mockResolvedValue(Buffer.from("%PDF-valid-content"));

    await expect(
      service.ensureReceiptForPayment("tenant-1", "payment-1"),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(minio.uploadBuffer).not.toHaveBeenCalled();
    expect(minio.uploadBufferIfAbsent).not.toHaveBeenCalled();
    expect(prisma.file.create).not.toHaveBeenCalled();
    expect(prisma.document.create).not.toHaveBeenCalled();
    expect(defaultPaymentState.receiptStatus).toBe(ReceiptStatus.FAILED);
  });

  it.each([
    ["File", () => prisma.file.findFirst.mockResolvedValueOnce({ id: "file-legacy" } as never)],
    ["Document", () => {
      Object.assign(defaultPaymentState, { receiptDocumentId: "document-legacy" });
      prisma.document.findUnique.mockResolvedValueOnce(receiptDocument() as never);
    }],
    ["audit", () => prisma.paymentAuditLog.findFirst.mockResolvedValueOnce({ id: "audit-legacy" } as never)],
    ["generatedAt", () => Object.assign(defaultPaymentState, { receiptGeneratedAt: new Date("2026-08-30T00:00:00.000Z") })],
    ["snapshot metadata", () => Object.assign(defaultPaymentState, { receiptSnapshotVersion: 'PAYMENT_RECEIPT_V1' })],
  ] as const)("fails closed when legacy receipt has %s evidence", async (_evidence, configureEvidence) => {
    Object.assign(defaultPaymentState, {
      receiptStatus: ReceiptStatus.PENDING,
      receiptNumber: "R-COMPLE-2026-000001",
    });
    configureEvidence();

    await expect(
      service.ensureReceiptForPayment("tenant-1", "payment-1"),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(minio.uploadBuffer).not.toHaveBeenCalled();
    expect(prisma.receiptSequence.create).not.toHaveBeenCalled();
    expect(prisma.receiptSequence.update).not.toHaveBeenCalled();
    expect(prisma.paymentAuditLog.create).not.toHaveBeenCalled();
    expect(defaultPaymentState.receiptSnapshot).toBeNull();
  });

  it("returns an already complete receipt without creating or notifying again", async () => {
    const validPdf = Buffer.from("%PDF-validated-receipt");
    const validChecksum = createHash("sha256").update(validPdf).digest("hex");
    prisma.payment.findUnique.mockResolvedValue({
      id: "payment-1",
      tenantId: "tenant-1",
      buildingId: "building-1",
      unitId: "unit-1",
      amount: 4050000,
      currency: "ARS",
      method: "TRANSFER",
      status: "RECONCILED",
      canceledAt: null,
      receiptStatus: ReceiptStatus.READY,
      receiptNumber: "R-COMPLE-2026-000001",
      receiptDocumentId: "document-1",
      createdByUserId: "resident-1",
      approvedByUserId: "admin-1",
      approvedAt: "2026-07-24T12:00:00.000Z",
      reference: "TRX-001",
      paymentAllocations: [],
      unit: { label: "TN-01-01" },
      building: { name: "Complejo Horizonte" },
    } as never);
    prisma.document.findUnique.mockResolvedValue({
      id: "document-1",
      tenantId: "tenant-1",
      category: "RECEIPT",
      buildingId: "building-1",
      unitId: "unit-1",
      file: {
        id: "file-1",
        tenantId: "tenant-1",
        bucket: DEFAULT_BUCKET,
        objectKey:
          "tenant/tenant-1/payments/payment-1/receipts/R-COMPLE-2026-000001.pdf",
        mimeType: "application/pdf",
        size: validPdf.length,
        checksum: validChecksum,
      },
    } as never);
    prisma.paymentAuditLog.findFirst.mockResolvedValue({
      id: "audit-1",
    } as never);
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: validPdf.length });
    minio.getObjectBuffer.mockResolvedValue(validPdf);

    await service.ensureReceiptForPayment("tenant-1", "payment-1");
    await service.ensureReceiptForPayment("tenant-1", "payment-1");

    expect(minio.uploadBuffer).not.toHaveBeenCalled();
    expect(prisma.file.create).not.toHaveBeenCalled();
    expect(prisma.document.create).not.toHaveBeenCalled();
    expect(prisma.paymentAuditLog.create).not.toHaveBeenCalled();
    expect(notificationsService.createNotification).not.toHaveBeenCalled();
  });

  it('fails closed when a READY receipt points to a different same-tenant object key', async () => {
    configureExistingReadyReceipt({}, {
      objectKey: 'tenant/tenant-1/payments/payment-2/receipts/R-OTHER-2026-000001.pdf',
    });

    await expect(
      service.ensureReceiptForPayment('tenant-1', 'payment-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(minio.presignDownload).not.toHaveBeenCalled();
  });

  it('fails closed when a READY receipt File has a non-PDF MIME type', async () => {
    configureExistingReadyReceipt({}, { mimeType: 'image/png' });

    await expect(
      service.ensureReceiptForPayment('tenant-1', 'payment-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(minio.presignDownload).not.toHaveBeenCalled();
  });

  it('fails closed when a canonical receipt object does not match its persisted checksum', async () => {
    const wrongPdf = Buffer.from('%PDF-wrong-receipt');
    configureExistingReadyReceipt({}, {
      size: wrongPdf.length,
      checksum: 'persisted-checksum-for-another-object',
    });
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: wrongPdf.length });
    minio.getObjectBuffer.mockResolvedValue(wrongPdf);

    await expect(
      service.ensureReceiptForPayment('tenant-1', 'payment-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(minio.presignDownload).not.toHaveBeenCalled();
  });

  it('fails closed when a receipt Document is linked to a File from another tenant', async () => {
    configureExistingReadyReceipt({}, { tenantId: 'tenant-2' });

    await expect(
      service.ensureReceiptForPayment('tenant-1', 'payment-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(minio.presignDownload).not.toHaveBeenCalled();
  });

  it('reuses a valid canonical READY receipt idempotently', async () => {
    const validPdf = Buffer.from('%PDF-valid-canonical-receipt');
    const checksum = createHash('sha256').update(validPdf).digest('hex');
    configureExistingReadyReceipt({}, {
      size: validPdf.length,
      checksum,
    });
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: validPdf.length });
    minio.getObjectBuffer.mockResolvedValue(validPdf);

    const first = await service.ensureReceiptForPayment('tenant-1', 'payment-1');
    const second = await service.ensureReceiptForPayment('tenant-1', 'payment-1');

    expect(first).toEqual(second);
    expect(minio.presignDownload).toHaveBeenCalledTimes(2);
    expect(minio.uploadBuffer).not.toHaveBeenCalled();
    expect(prisma.file.updateMany).not.toHaveBeenCalled();
    expect(prisma.paymentAuditLog.create).not.toHaveBeenCalled();
    expect(notificationsService.createNotification).not.toHaveBeenCalled();
  });

  it('preserves the original issuance timestamp across READY retries', async () => {
    const originalGeneratedAt = new Date('2026-08-30T12:34:56.000Z');
    const originalSnapshotCreatedAt = new Date('2026-08-29T12:34:56.000Z');
    const snapshotFactory = Reflect.get(service, 'createReceiptSnapshot') as (
      payment: unknown,
      receiptNumber: string,
      tenantDisplayName: string,
      approvedByUserName: string,
      createdAt: Date,
    ) => unknown;
    const hashSnapshot = Reflect.get(service, 'hashReceiptSnapshot') as (
      snapshotValue: unknown,
    ) => string;
    const snapshot = snapshotFactory.call(
      service,
      defaultPaymentState,
      'R-COMPLE-2026-000001',
      'Complejo Horizonte',
      'Admin',
      originalSnapshotCreatedAt,
    );
    const snapshotHash = hashSnapshot.call(service, snapshot);
    const generateReceiptPdfFromSnapshot = Reflect.get(
      service,
      'generateReceiptPdfFromSnapshot',
    ) as (snapshotValue: unknown) => Buffer;
    const validPdf = generateReceiptPdfFromSnapshot.call(service, snapshot);
    Object.assign(defaultPaymentState, {
      receiptStatus: ReceiptStatus.READY,
      receiptNumber: 'R-COMPLE-2026-000001',
      receiptDocumentId: 'document-1',
      receiptSnapshot: snapshot,
      receiptSnapshotVersion: 'PAYMENT_RECEIPT_V1',
      receiptSnapshotHash: snapshotHash,
      receiptSnapshotCreatedAt: originalSnapshotCreatedAt,
      receiptGeneratedAt: originalGeneratedAt,
    });
    const checksum = createHash('sha256').update(validPdf).digest('hex');
    prisma.document.findUnique.mockResolvedValue(
      receiptDocument({ size: validPdf.length, checksum }) as never,
    );
    prisma.paymentAuditLog.findFirst.mockResolvedValue({ id: 'audit-1' } as never);
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: validPdf.length });
    minio.getObjectBuffer.mockResolvedValue(validPdf);

    const before = {
      receiptNumber: defaultPaymentState.receiptNumber,
      receiptSnapshot: defaultPaymentState.receiptSnapshot,
      receiptSnapshotHash: defaultPaymentState.receiptSnapshotHash,
      receiptSnapshotVersion: defaultPaymentState.receiptSnapshotVersion,
      receiptSnapshotCreatedAt: defaultPaymentState.receiptSnapshotCreatedAt,
      receiptGeneratedAt: defaultPaymentState.receiptGeneratedAt,
      receiptDocumentId: defaultPaymentState.receiptDocumentId,
    };
    const first = await service.ensureReceiptForPayment('tenant-1', 'payment-1');
    const second = await service.ensureReceiptForPayment('tenant-1', 'payment-1');

    expect(first).toEqual(second);
    expect(defaultPaymentState).toEqual(expect.objectContaining(before));
    expect(defaultPaymentState.receiptGeneratedAt).toEqual(originalGeneratedAt);
    expect(prisma.file.create).not.toHaveBeenCalled();
    expect(prisma.document.create).not.toHaveBeenCalled();
    expect(prisma.paymentAuditLog.create).not.toHaveBeenCalled();
    expect(minio.uploadBuffer).not.toHaveBeenCalled();
  });

  it('fails closed when a READY snapshot-backed receipt lacks its issuance timestamp', async () => {
    const snapshotFactory = Reflect.get(service, 'createReceiptSnapshot') as (
      payment: unknown,
      receiptNumber: string,
      tenantDisplayName: string,
      approvedByUserName: string,
      createdAt: Date,
    ) => unknown;
    const hashSnapshot = Reflect.get(service, 'hashReceiptSnapshot') as (
      snapshotValue: unknown,
    ) => string;
    const snapshot = snapshotFactory.call(
      service,
      defaultPaymentState,
      'R-COMPLE-2026-000001',
      'Complejo Horizonte',
      'Admin',
      new Date('2026-08-29T12:34:56.000Z'),
    );
    Object.assign(defaultPaymentState, {
      receiptStatus: ReceiptStatus.READY,
      receiptNumber: 'R-COMPLE-2026-000001',
      receiptDocumentId: 'document-1',
      receiptSnapshot: snapshot,
      receiptSnapshotVersion: 'PAYMENT_RECEIPT_V1',
      receiptSnapshotHash: hashSnapshot.call(service, snapshot),
      receiptSnapshotCreatedAt: new Date('2026-08-29T12:34:56.000Z'),
      receiptGeneratedAt: null,
    });

    await expect(
      service.ensureReceiptForPayment('tenant-1', 'payment-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(minio.uploadBuffer).not.toHaveBeenCalled();
    expect(minio.presignDownload).not.toHaveBeenCalled();
    expect(prisma.file.create).not.toHaveBeenCalled();
    expect(prisma.document.create).not.toHaveBeenCalled();
    expect(prisma.paymentAuditLog.create).not.toHaveBeenCalled();
    expect(notificationsService.createNotification).not.toHaveBeenCalled();
    expect(defaultPaymentState.receiptGeneratedAt).toBeNull();
  });

  it('returns a complete legacy READY receipt without requiring a snapshot', async () => {
    const validPdf = Buffer.from('%PDF-complete-legacy-ready');
    const checksum = createHash('sha256').update(validPdf).digest('hex');
    Object.assign(defaultPaymentState, {
      receiptStatus: ReceiptStatus.READY,
      receiptNumber: 'R-COMPLE-2026-000001',
      receiptDocumentId: 'document-1',
      receiptGeneratedAt: new Date('2026-08-29T12:34:56.000Z'),
      receiptSnapshot: null,
      receiptSnapshotVersion: null,
      receiptSnapshotHash: null,
    });
    prisma.document.findUnique.mockResolvedValue(
      receiptDocument({ size: validPdf.length, checksum }) as never,
    );
    prisma.paymentAuditLog.findFirst.mockResolvedValue({ id: 'audit-1' } as never);
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: validPdf.length });
    minio.getObjectBuffer.mockResolvedValue(validPdf);

    const result = await service.ensureReceiptForPayment('tenant-1', 'payment-1');

    expect(result?.receiptNumber).toBe('R-COMPLE-2026-000001');
    expect(result?.documentId).toBe('document-1');
    expect(minio.uploadBuffer).not.toHaveBeenCalled();
    expect(prisma.file.create).not.toHaveBeenCalled();
    expect(prisma.document.create).not.toHaveBeenCalled();
    expect(prisma.paymentAuditLog.create).not.toHaveBeenCalled();
  });

  it('fails closed for a checksum-less legacy READY receipt instead of fabricating a snapshot', async () => {
    configureExistingReadyReceipt({}, {
      size: 123,
      checksum: null,
    });
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: 123 });
    minio.getObjectBuffer.mockResolvedValue(Buffer.from('%PDF-legacy-receipt'));

    await expect(
      service.ensureReceiptForPayment('tenant-1', 'payment-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(minio.uploadBuffer).not.toHaveBeenCalled();
    expect(prisma.file.updateMany).not.toHaveBeenCalled();
  });

  it('fails closed when the persisted receipt snapshot is tampered', async () => {
    minio.uploadBuffer.mockRejectedValueOnce(new Error('stop after snapshot'));
    await expect(
      service.ensureReceiptForPayment('tenant-1', 'payment-1'),
    ).resolves.toBeNull();

    const snapshot = defaultPaymentState.receiptSnapshot as Record<string, unknown>;
    snapshot.tenantDisplayName = 'Tampered tenant';

    await expect(
      service.ensureReceiptForPayment('tenant-1', 'payment-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(minio.uploadBuffer).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the persisted receipt snapshot hash is tampered', async () => {
    minio.uploadBuffer.mockRejectedValueOnce(new Error('stop after snapshot'));
    await expect(
      service.ensureReceiptForPayment('tenant-1', 'payment-1'),
    ).resolves.toBeNull();

    defaultPaymentState.receiptSnapshotHash = 'tampered-hash';

    await expect(
      service.ensureReceiptForPayment('tenant-1', 'payment-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(minio.uploadBuffer).toHaveBeenCalledTimes(1);
  });

  it('fails closed for an unsupported receipt snapshot version', async () => {
    minio.uploadBuffer.mockRejectedValueOnce(new Error('stop after snapshot'));
    await expect(
      service.ensureReceiptForPayment('tenant-1', 'payment-1'),
    ).resolves.toBeNull();

    defaultPaymentState.receiptSnapshotVersion = 'PAYMENT_RECEIPT_V0';

    await expect(
      service.ensureReceiptForPayment('tenant-1', 'payment-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(minio.uploadBuffer).toHaveBeenCalledTimes(1);
  });

  it('reconciles stale partial File metadata during snapshot-backed recovery', async () => {
    const payment = readyReceiptPayment({ receiptStatus: ReceiptStatus.PENDING });
    const generateReceiptPDF = Reflect.get(service, 'generateReceiptPDF') as (
      payment: unknown,
      receiptNumber: string,
      approvedByUserName: string,
      tenantDisplayName: string,
    ) => Promise<Buffer>;
    const canonicalPdf = await generateReceiptPDF.call(
      service,
      payment,
      'R-COMPLE-2026-000001',
      'Admin',
      'Complejo Horizonte',
    );
    const snapshot = Reflect.get(service, 'createReceiptSnapshot') as (
      payment: unknown,
      receiptNumber: string,
      tenantDisplayName: string,
      approvedByUserName: string,
      createdAt: Date,
    ) => unknown;
    const hashSnapshot = Reflect.get(service, 'hashReceiptSnapshot') as (
      snapshotValue: unknown,
    ) => string;
    const receiptSnapshot = snapshot.call(
      service,
      payment,
      'R-COMPLE-2026-000001',
      'Complejo Horizonte',
      'Admin',
      new Date('2026-08-31T00:00:00.000Z'),
    );
    configureExistingReadyReceipt({
      receiptStatus: ReceiptStatus.PENDING,
      receiptSnapshot,
      receiptSnapshotVersion: 'PAYMENT_RECEIPT_V1',
      receiptSnapshotHash: hashSnapshot.call(service, receiptSnapshot),
      receiptSnapshotCreatedAt: new Date('2026-08-31T00:00:00.000Z'),
    }, {
      mimeType: 'application/octet-stream',
      size: 1,
      checksum: 'stale-checksum',
    });
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: canonicalPdf.length });
    minio.getObjectBuffer.mockResolvedValue(canonicalPdf);

    const result = await service.ensureReceiptForPayment('tenant-1', 'payment-1');

    expect(result?.receiptNumber).toBe('R-COMPLE-2026-000001');
    expect(prisma.file.updateMany).toHaveBeenCalledWith({
      where: { id: 'file-1', tenantId: 'tenant-1' },
      data: {
        bucket: DEFAULT_BUCKET,
        objectKey: canonicalReceiptKey(),
        mimeType: 'application/pdf',
        size: canonicalPdf.length,
        checksum: createHash('sha256').update(canonicalPdf).digest('hex'),
      },
    });
  });

  it("reuses a pre-existing canonical storage object when DB finalization is absent", async () => {
    const payment = {
      id: "payment-1",
      tenantId: "tenant-1",
      buildingId: "building-1",
      unitId: "unit-1",
      amount: 4050000,
      currency: "ARS",
      method: "TRANSFER",
      status: "APPROVED",
      canceledAt: null,
      receiptStatus: ReceiptStatus.PENDING,
      receiptNumber: "R-COMPLE-2026-000001",
      receiptDocumentId: null,
      createdByUserId: "resident-1",
      approvedByUserId: "admin-1",
      approvedAt: "2026-07-24T12:00:00.000Z",
      reference: "TRX-001",
      paymentAllocations: [],
      unit: { label: "TN-01-01" },
      building: { name: "Complejo Horizonte" },
    } as never;
    const snapshot = Reflect.get(service, 'createReceiptSnapshot') as (
      payment: unknown,
      receiptNumber: string,
      tenantDisplayName: string,
      approvedByUserName: string,
      createdAt: Date,
    ) => unknown;
    const hashSnapshot = Reflect.get(service, 'hashReceiptSnapshot') as (
      snapshotValue: unknown,
    ) => string;
    const receiptSnapshot = snapshot.call(
      service,
      payment,
      'R-COMPLE-2026-000001',
      'Complejo Horizonte',
      'Admin',
      new Date('2026-08-31T00:00:00.000Z'),
    );
    Object.assign(payment, {
      receiptSnapshot,
      receiptSnapshotVersion: 'PAYMENT_RECEIPT_V1',
      receiptSnapshotHash: hashSnapshot.call(service, receiptSnapshot),
      receiptSnapshotCreatedAt: new Date('2026-08-31T00:00:00.000Z'),
    });
    const generateReceiptPDF = Reflect.get(service, "generateReceiptPDF") as (
      payment: unknown,
      receiptNumber: string,
      approvedByUserName: string,
      tenantDisplayName: string,
    ) => Promise<Buffer>;
    const existingPdf = await generateReceiptPDF.call(
      service,
      payment,
      "R-COMPLE-2026-000001",
      "Admin",
      "Complejo Horizonte",
    );
    prisma.payment.findUnique.mockResolvedValue(payment);
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: existingPdf.length });
    minio.getObjectBuffer.mockResolvedValue(existingPdf);

    const result = await service.ensureReceiptForPayment(
      "tenant-1",
      "payment-1",
    );

    expect(result?.receiptNumber).toBe("R-COMPLE-2026-000001");
    expect(minio.uploadBuffer).not.toHaveBeenCalled();
    expect(prisma.file.create).toHaveBeenCalledTimes(1);
    expect(prisma.document.create).toHaveBeenCalledTimes(1);
  });

  it("recovers after storage succeeds but DB finalization fails, reusing the number and object", async () => {
    let paymentState = {
      id: "payment-1",
      tenantId: "tenant-1",
      buildingId: "building-1",
      unitId: "unit-1",
      amount: 4050000,
      currency: "ARS",
      method: "TRANSFER",
      status: "RECONCILED",
      canceledAt: null,
      receiptStatus: ReceiptStatus.PENDING,
      receiptNumber: null as string | null,
      receiptDocumentId: null as string | null,
      receiptError: null as string | null,
      createdByUserId: "resident-1",
      approvedByUserId: "admin-1",
      approvedAt: "2026-07-24T12:00:00.000Z",
      reference: "TRX-001",
      paymentAllocations: [],
      unit: { label: "TN-01-01" },
      building: { name: "Complejo Horizonte" },
    } as never;
    let storedObject: Buffer | null = null;
    prisma.payment.findUnique.mockImplementation(async () => paymentState);
    prisma.payment.update.mockImplementation(async ({ data }) => {
      paymentState = { ...paymentState, ...data } as never;
      return paymentState;
    });
    minio.objectExists.mockImplementation(async () => storedObject !== null);
    minio.statObject.mockImplementation(async () => ({ size: storedObject?.length ?? 0 }));
    minio.getObjectBuffer.mockImplementation(async () => storedObject!);
    minio.uploadBuffer.mockImplementation(async (_bucket, _key, content) => {
      storedObject = content;
    });
    prisma.document.create.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(
      service.ensureReceiptForPayment("tenant-1", "payment-1"),
    ).resolves.toBeNull();
    expect(storedObject).not.toBeNull();
    const firstPdf = Buffer.from(storedObject!);
    const firstSnapshotHash = paymentState.receiptSnapshotHash;
    const reservedNumber = paymentState.receiptNumber;

    paymentState = {
      ...paymentState,
      unit: { label: "MUTATED-UNIT" },
      building: { name: "MUTATED-BUILDING" },
      reference: "MUTATED-REFERENCE",
      paymentAllocations: [{
        amount: 10000,
        charge: { period: "2099-12", concept: "MUTATED-CONCEPT" },
      }],
    } as never;
    prisma.tenant.findUnique.mockResolvedValue({ name: "MUTATED-TENANT", brandName: "MUTATED-BRAND" } as never);
    prisma.user.findUnique.mockResolvedValue({ name: "MUTATED-APPROVER" } as never);

    prisma.document.create.mockResolvedValue({ id: "document-1" } as never);
    const result = await service.ensureReceiptForPayment(
      "tenant-1",
      "payment-1",
    );

    expect(result?.receiptNumber).toBe(reservedNumber);
    expect(minio.uploadBuffer).toHaveBeenCalledTimes(1);
    expect(storedObject).toEqual(firstPdf);
    expect(paymentState.receiptSnapshotHash).toBe(firstSnapshotHash);
    expect(storedObject?.includes(Buffer.from("MUTATED"))).toBe(false);
    expect(paymentState.receiptStatus).toBe(ReceiptStatus.READY);
    expect(prisma.paymentAuditLog.create).toHaveBeenCalledTimes(1);
  });

  it('renews a live receipt lease using the database timestamp', async () => {
    const renewLease = Reflect.get(service, 'renewReceiptGenerationLease') as (
      tenantId: string,
      paymentId: string,
      generationToken: string,
    ) => Promise<void>;
    prisma.payment.updateMany.mockResolvedValueOnce({ count: 1 });

    await renewLease.call(service, 'tenant-1', 'payment-1', 'generation-token');

    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'payment-1',
        tenantId: 'tenant-1',
        receiptGenerationToken: 'generation-token',
        receiptGenerationLeaseUntil: { gt: new Date('2026-08-31T00:00:00.000Z') },
      },
      data: {
        receiptGenerationLeaseUntil: new Date('2026-08-31T00:05:00.000Z'),
      },
    });
  });

  it('fails closed when a stale receipt owner tries to renew', async () => {
    const renewLease = Reflect.get(service, 'renewReceiptGenerationLease') as (
      tenantId: string,
      paymentId: string,
      generationToken: string,
    ) => Promise<void>;
    prisma.payment.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      renewLease.call(service, 'tenant-1', 'payment-1', 'stale-token'),
    ).rejects.toThrow('no longer owned');
  });

  it('does not clean up a newer owner through a tokenless failure path', async () => {
    prisma.payment.findUnique.mockResolvedValueOnce({
      receiptStatus: ReceiptStatus.PENDING,
      receiptGenerationToken: 'new-owner-token',
      receiptGenerationLeaseUntil: new Date('2026-08-31T00:05:00.000Z'),
    } as never);
    const markFailed = Reflect.get(service, 'markReceiptGenerationFailedIfNeeded') as (
      tenantId: string,
      paymentId: string,
      errorMessage: string,
    ) => Promise<void>;

    await markFailed.call(service, 'tenant-1', 'payment-1', 'old failure');

    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
  });

  it('does not clean up an expired owner after its storage attempt fails', async () => {
    prisma.payment.findUnique.mockResolvedValueOnce({
      receiptStatus: ReceiptStatus.PENDING,
      receiptGenerationToken: 'expired-token',
      receiptGenerationLeaseUntil: new Date('2026-08-30T23:59:59.000Z'),
    } as never);
    const markFailed = Reflect.get(service, 'markReceiptGenerationFailedIfNeeded') as (
      tenantId: string,
      paymentId: string,
      errorMessage: string,
      generationToken: string,
    ) => Promise<void>;

    await markFailed.call(
      service,
      'tenant-1',
      'payment-1',
      'expired failure',
      'expired-token',
    );

    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
  });

  it('does not let a stale READY owner clear a replacement owner', async () => {
    prisma.payment.findUnique.mockResolvedValueOnce({
      receiptStatus: ReceiptStatus.READY,
      receiptGenerationToken: 'replacement-token',
      receiptGenerationLeaseUntil: new Date('2026-08-31T00:05:00.000Z'),
    } as never);
    const markFailed = Reflect.get(service, 'markReceiptGenerationFailedIfNeeded') as (
      tenantId: string,
      paymentId: string,
      errorMessage: string,
      generationToken: string,
    ) => Promise<void>;

    await markFailed.call(
      service,
      'tenant-1',
      'payment-1',
      'stale READY failure',
      'stale-token',
    );

    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
  });

  it('returns an explicit in-progress conflict for an active receipt owner', async () => {
    const createSnapshot = Reflect.get(service, 'createReceiptSnapshot') as (
      payment: unknown,
      receiptNumber: string,
      tenantDisplayName: string,
      approvedByUserName: string,
      createdAt: Date,
    ) => unknown;
    const hashSnapshot = Reflect.get(service, 'hashReceiptSnapshot') as (
      snapshotValue: unknown,
    ) => string;
    const snapshot = createSnapshot.call(
      service,
      defaultPaymentState,
      'R-COMPLE-2026-000001',
      'Complejo Horizonte',
      'Admin',
      new Date('2026-08-31T00:00:00.000Z'),
    );
    Object.assign(defaultPaymentState, {
      receiptNumber: 'R-COMPLE-2026-000001',
      receiptSnapshot: snapshot,
      receiptSnapshotVersion: 'PAYMENT_RECEIPT_V1',
      receiptSnapshotHash: hashSnapshot.call(service, snapshot),
      receiptSnapshotCreatedAt: new Date('2026-08-31T00:00:00.000Z'),
      receiptGenerationToken: 'active-owner',
      receiptGenerationLeaseUntil: new Date('2026-08-31T00:05:00.000Z'),
    });
    jest.spyOn(service as never, 'waitForReceiptGeneration').mockResolvedValue(null);

    await expect(
      service.ensureReceiptForPayment('tenant-1', 'payment-1'),
    ).rejects.toMatchObject({
      response: { message: 'RECEIPT_GENERATION_IN_PROGRESS' },
    });

    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    expect(minio.uploadBuffer).not.toHaveBeenCalled();
    expect(minio.deleteObject).not.toHaveBeenCalled();
  });

  it('returns a completed receipt after waiting without reacquiring its lease', async () => {
    const validPdf = Buffer.from('%PDF-completed-by-owner');
    const snapshotFactory = Reflect.get(service, 'createReceiptSnapshot') as (
      payment: unknown,
      receiptNumber: string,
      tenantDisplayName: string,
      approvedByUserName: string,
      createdAt: Date,
    ) => unknown;
    const hashSnapshot = Reflect.get(service, 'hashReceiptSnapshot') as (
      snapshotValue: unknown,
    ) => string;
    const snapshot = snapshotFactory.call(
      service,
      defaultPaymentState,
      'R-COMPLE-2026-000001',
      'Complejo Horizonte',
      'Admin',
      new Date('2026-08-31T00:00:00.000Z'),
    );
    Object.assign(defaultPaymentState, {
      receiptStatus: ReceiptStatus.READY,
      receiptNumber: 'R-COMPLE-2026-000001',
      receiptDocumentId: 'document-1',
      receiptSnapshot: snapshot,
      receiptSnapshotVersion: 'PAYMENT_RECEIPT_V1',
      receiptSnapshotHash: hashSnapshot.call(service, snapshot),
      receiptGenerationToken: null,
      receiptGenerationLeaseUntil: null,
    });
    prisma.document.findUnique.mockResolvedValueOnce(
      receiptDocument({
        size: validPdf.length,
        checksum: createHash('sha256').update(validPdf).digest('hex'),
      }) as never,
    );
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: validPdf.length });
    minio.getObjectBuffer.mockResolvedValue(validPdf);

    const waitForReceiptGeneration = Reflect.get(
      service,
      'waitForReceiptGeneration',
    ) as (
      tenantId: string,
      paymentId: string,
    ) => Promise<unknown>;
    const result = await waitForReceiptGeneration.call(
      service,
      'tenant-1',
      'payment-1',
    );

    expect(result).toEqual(
      expect.objectContaining({ receiptNumber: 'R-COMPLE-2026-000001' }),
    );
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  it('validates the winner after a conditional canonical object-create race', async () => {
    const pdf = Buffer.from('%PDF-race-winner');
    minio.objectExists.mockResolvedValueOnce(false);
    minio.uploadBufferIfAbsent.mockResolvedValueOnce(false);
    minio.statObject.mockResolvedValueOnce({ size: pdf.length });
    minio.getObjectBuffer.mockResolvedValueOnce(pdf);
    const ensureStorage = Reflect.get(service, 'ensureReceiptStorageObject') as (
      bucket: string,
      fileKey: string,
      content: Buffer,
    ) => Promise<unknown>;

    await expect(
      ensureStorage.call(service, DEFAULT_BUCKET, 'tenant-1/race.pdf', pdf),
    ).resolves.toEqual(expect.objectContaining({
      objectKey: 'tenant-1/race.pdf',
      size: pdf.length,
    }));
    expect(minio.uploadBufferIfAbsent).toHaveBeenCalledWith(
      DEFAULT_BUCKET,
      'tenant-1/race.pdf',
      pdf,
      'application/pdf',
    );
    expect(minio.uploadBuffer).not.toHaveBeenCalled();
  });

  it('marks the heartbeat lost when the database no longer recognizes its lease', async () => {
    jest.useFakeTimers();
    try {
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });
      const startHeartbeat = Reflect.get(service, 'startReceiptGenerationHeartbeat') as (
        tenantId: string,
        paymentId: string,
        generationToken: string,
      ) => { assertOwned(): void; stop(): Promise<void> };
      const heartbeat = startHeartbeat.call(
        service,
        'tenant-1',
        'payment-1',
        'generation-token',
      );

      await jest.advanceTimersByTimeAsync(100000);
      expect(() => heartbeat.assertOwned()).toThrow('no longer owned');
      await heartbeat.stop();
    } finally {
      jest.useRealTimers();
    }
  });
});
