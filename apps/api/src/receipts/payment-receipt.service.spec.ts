import { PaymentReceiptService } from './payment-receipt.service';
import { ReceiptStatus } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

describe('PaymentReceiptService', () => {
  const DEFAULT_BUCKET = 'buildingos-test';

  const prisma = {
    payment: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    document: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    file: {
      create: jest.fn(),
    },
    tenant: {
      findUnique: jest.fn(),
    },
    paymentAuditLog: {
      create: jest.fn(),
    },
    receiptSequence: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
    user: {
      findUnique: jest.fn(),
    },
  };
  const minio = {
    getDefaultBucket: jest.fn(() => DEFAULT_BUCKET),
    uploadBuffer: jest.fn(),
    presignDownload: jest.fn(),
  };
  const notificationsService = {
    createNotification: jest.fn(),
  };

  const service = new PaymentReceiptService(
    prisma as never,
    minio as never,
    notificationsService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    minio.getDefaultBucket.mockReturnValue(DEFAULT_BUCKET);
    prisma.$transaction.mockImplementation(async (callback: (tx: never) => Promise<unknown>) => {
      const tx = {
        receiptSequence: prisma.receiptSequence,
      } as never;
      return callback(tx);
    });
    prisma.payment.findUnique.mockResolvedValue({
      id: 'payment-1',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      unitId: 'unit-1',
      amount: 4050000,
      currency: 'ARS',
      method: 'TRANSFER',
      createdByUserId: 'resident-1',
      approvedByUserId: 'admin-1',
      approvedAt: '2026-07-24T12:00:00.000Z',
      reference: 'TRX-001',
      paymentAllocations: [{
        chargeId: 'charge-1',
        amount: 4050000,
        charge: {
          period: '2025-10',
          concept: 'Condominio ordinario 2025-10',
          expensePeriod: { year: 2025, month: 10 },
        },
      }],
      unit: { label: 'TN-01-01' },
      building: { name: 'Complejo Horizonte' },
      receiptDocumentId: null,
      receiptNumber: null,
    } as never);
    prisma.tenant.findUnique.mockResolvedValue({ name: 'Complejo Horizonte', brandName: null } as never);
    prisma.user.findUnique.mockResolvedValue({ name: 'Admin' } as never);
    prisma.receiptSequence.findUnique.mockResolvedValue(null);
    prisma.receiptSequence.create.mockResolvedValue({ id: 'sequence-1', lastNumber: 0 } as never);
    prisma.receiptSequence.update.mockResolvedValue({ id: 'sequence-1' } as never);
    prisma.file.create.mockResolvedValue({ id: 'file-1' } as never);
    prisma.document.create.mockResolvedValue({ id: 'document-1', file: { bucket: DEFAULT_BUCKET, objectKey: 'object-1' } } as never);
    prisma.payment.update.mockResolvedValue({} as never);
    prisma.paymentAuditLog.create.mockResolvedValue({} as never);
    notificationsService.createNotification.mockResolvedValue({} as never);
    minio.presignDownload.mockResolvedValue('https://download.example/receipt.pdf');
  });

  it('uses the configured bucket when generating a new receipt', async () => {
    const result = await service.ensureReceiptForPayment('payment-1');
    const uploadedBuffer = minio.uploadBuffer.mock.calls[0][2] as Buffer;
    const tmpReceiptPath = '/tmp/buildingos-payment-receipt-test.pdf';

    expect(minio.uploadBuffer).toHaveBeenCalledWith(
      DEFAULT_BUCKET,
      expect.stringContaining('/receipt_R-'),
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
    expect(normalizedPdfText).not.toContain('œ');
    expect(normalizedPdfText).not.toContain('Ø');
    expect(normalizedPdfText).not.toContain('¢');
    expect(normalizedPdfText).toContain('ARS 40.500,00');
    writeFileSync(tmpReceiptPath, uploadedBuffer);
    expect(execFileSync('file', [tmpReceiptPath], { encoding: 'utf8' })).toContain('PDF document');
    try {
      const pdfInfo = execFileSync('pdfinfo', [tmpReceiptPath], { encoding: 'utf8' });
      expect(pdfInfo).toContain('Pages:');
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    expect(prisma.file.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        bucket: DEFAULT_BUCKET,
        originalName: expect.stringMatching(/\.pdf$/),
        mimeType: 'application/pdf',
        size: uploadedBuffer.length,
      }),
    }));
    expect(prisma.payment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        receiptStatus: ReceiptStatus.READY,
        receiptError: null,
      }),
    }));
    expect(minio.presignDownload).toHaveBeenCalledWith(
      DEFAULT_BUCKET,
      expect.stringContaining('/receipt_R-'),
      3600,
    );
    expect(result?.fileKey).toContain('/receipt_R-');
  });

  it('uses the persisted file bucket when reusing an existing receipt', async () => {
    prisma.payment.findUnique.mockResolvedValueOnce({
      id: 'payment-1',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      unitId: 'unit-1',
      amount: 12345,
      currency: 'ARS',
      method: 'TRANSFER',
      createdByUserId: 'resident-1',
      approvedByUserId: 'admin-1',
      approvedAt: '2026-07-24T12:00:00.000Z',
      reference: 'TRX-001',
      paymentAllocations: [],
      unit: { label: 'TN-01-01' },
      building: { name: 'Complejo Horizonte' },
      receiptDocumentId: 'document-1',
      receiptNumber: 'R-HZ-2026-000001',
    } as never);
    prisma.document.findUnique.mockResolvedValueOnce({
      id: 'document-1',
      file: { bucket: 'tenant-legacy-bucket', objectKey: 'receipt.pdf' },
    } as never);

    const result = await service.ensureReceiptForPayment('payment-1');

    expect(minio.presignDownload).toHaveBeenCalledWith('tenant-legacy-bucket', 'receipt.pdf', 3600);
    expect(minio.uploadBuffer).not.toHaveBeenCalled();
    expect(prisma.file.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      receiptNumber: 'R-HZ-2026-000001',
      documentId: 'document-1',
      fileKey: 'receipt.pdf',
      url: 'https://download.example/receipt.pdf',
    });
  });
});
