import { PaymentReceiptService } from './payment-receipt.service';
import { ReceiptStatus } from '@prisma/client';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

describe('PaymentReceiptService', () => {
  const DEFAULT_BUCKET = 'buildingos-test';
  const RECEIPT_MAX_TEXT_WIDTH = 595 - 72 - 72;
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

  function extractPdfTextLines(buffer: Buffer): string[] {
    const pdfText = buffer.toString('latin1');
    return Array.from(pdfText.matchAll(/\(([^()]*)\) Tj/g)).map((match) =>
      match[1]
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\'),
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

  it('encodes WinAnsi punctuation and falls back safely for unsupported characters', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      name: 'Consorcio “Central”',
      brandName: 'Administración “Central” — Horizonte €',
    } as never);
    prisma.user.findUnique.mockResolvedValue({ name: 'Niñez' } as never);
    prisma.payment.findUnique.mockResolvedValueOnce({
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
      reference: 'Referencia “curva” € 🙂 / validado \\ soporte',
      paymentAllocations: [{
        chargeId: 'charge-1',
        amount: 4050000,
        charge: {
          period: '2025-10',
          concept: 'Condominio – especial…',
          expensePeriod: { year: 2025, month: 10 },
        },
      }],
      unit: { label: 'TN-01-01' },
      building: { name: 'Torre “A”' },
      receiptDocumentId: null,
      receiptNumber: null,
    } as never);

    await service.ensureReceiptForPayment('payment-1');

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

  it('escapes parentheses and backslashes in the PDF stream after WinAnsi encoding', async () => {
    prisma.payment.findUnique.mockResolvedValueOnce({
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
      reference: 'Pago (confirmado) \\ soporte',
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

    await service.ensureReceiptForPayment('payment-1');

    const uploadedBuffer = minio.uploadBuffer.mock.calls[0][2] as Buffer;
    const pdfText = uploadedBuffer.toString('latin1');

    expect(pdfText).toContain('\\(confirmado\\)');
    expect(pdfText).toContain('\\\\ soporte');
    expect(uploadedBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
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

  it('splits long allocation lists across multiple PDF pages', async () => {
    prisma.payment.findUnique.mockResolvedValueOnce({
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

    await service.ensureReceiptForPayment('payment-1');

    const uploadedBuffer = minio.uploadBuffer.mock.calls[0][2] as Buffer;
    const pdfText = uploadedBuffer.toString('latin1');
    const pageObjects = pdfText.match(/\/Type \/Page(?!s)/g) || [];

    expect(pageObjects.length).toBe(2);
    expect(pdfText).toContain('Continúa en la siguiente página.');
    expect(pdfText).toContain('Página 1 de 2');
    expect(pdfText).toContain('Página 2 de 2');
  });

  it('wraps long receipt fields and keeps every line within the available width', async () => {
    const longTenantName = 'Consorcio Complejo Residencial Horizonte Torre Norte y Torre Sur con Administración Extendida y Consejo Vecinal';
    const longBuildingName = 'Torre Horizonte A con Hall Principal, Cocheras y SUM del Complejo Residencial Horizonte';
    const longReference = 'TRANSFERENCIA-EXTREMADAMENTE-LARGA-SIN-ESPACIOS-0123456789ABCDEFGHIJKLMN';
    const longConcept = 'Condominio ordinario con descripción extremadamente larga para validar el wrapping del PDF multipágina';

    prisma.payment.findUnique.mockResolvedValueOnce({
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

    const result = await service.ensureReceiptForPayment('payment-1');
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
});
