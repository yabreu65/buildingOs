import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../storage/minio.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DocumentCategory, DocumentVisibility, Prisma, ReceiptStatus } from '@prisma/client';
import {
  acquirePaymentLinkedDocumentLock,
  acquirePaymentReceiptLock,
} from '../common/payment-linked-document-lock';

export interface GenerateReceiptInput {
  paymentId: string;
  tenantId: string;
}

export interface ReceiptData {
  receiptNumber: string;
  documentId: string;
  fileKey: string;
  bucket: string;
  url: string;
}

type PaymentReceiptPayment = Prisma.PaymentGetPayload<{
  include: {
    unit: true;
    building: true;
    createdByUser: true;
    paymentAllocations: {
      include: {
        charge: {
          include: {
            expensePeriod: true;
          };
        };
      };
    };
  };
}>;

type ChargeWithAllocations = Prisma.ChargeGetPayload<{
  include: {
    paymentAllocations: {
      include: {
        payment: {
          select: {
            status: true;
          };
        };
      };
    };
  };
}>;

interface ReceiptPdfLine {
  text: string;
  kind: 'title' | 'heading' | 'body' | 'blank';
}

const RECEIPT_PDF_PAGE_WIDTH = 595;
const RECEIPT_PDF_MARGIN_LEFT = 72;
const RECEIPT_PDF_MARGIN_RIGHT = 72;
const RECEIPT_PDF_MAX_TEXT_WIDTH = RECEIPT_PDF_PAGE_WIDTH - RECEIPT_PDF_MARGIN_LEFT - RECEIPT_PDF_MARGIN_RIGHT;
const RECEIPT_PDF_MAX_BODY_LINES_PER_PAGE = 22;

const WIN_ANSI_CHAR_MAP: Record<string, string> = {
  '€': String.fromCharCode(0x80),
  '‚': String.fromCharCode(0x82),
  'ƒ': String.fromCharCode(0x83),
  '„': String.fromCharCode(0x84),
  '…': String.fromCharCode(0x85),
  '†': String.fromCharCode(0x86),
  '‡': String.fromCharCode(0x87),
  'ˆ': String.fromCharCode(0x88),
  '‰': String.fromCharCode(0x89),
  'Š': String.fromCharCode(0x8A),
  '‹': String.fromCharCode(0x8B),
  'Œ': String.fromCharCode(0x8C),
  'Ž': String.fromCharCode(0x8E),
  '‘': String.fromCharCode(0x91),
  '’': String.fromCharCode(0x92),
  '“': String.fromCharCode(0x93),
  '”': String.fromCharCode(0x94),
  '•': String.fromCharCode(0x95),
  '–': String.fromCharCode(0x96),
  '—': String.fromCharCode(0x97),
  '˜': String.fromCharCode(0x98),
  '™': String.fromCharCode(0x99),
  'š': String.fromCharCode(0x9A),
  '›': String.fromCharCode(0x9B),
  'œ': String.fromCharCode(0x9C),
  'ž': String.fromCharCode(0x9E),
  'Ÿ': String.fromCharCode(0x9F),
};

@Injectable()
export class PaymentReceiptService {
  private readonly logger = new Logger(PaymentReceiptService.name);
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly notificationsService: NotificationsService,
  ) {
    this.bucket = this.minio.getDefaultBucket();
  }

  /**
   * Ensure a receipt exists for the given payment.
   * Idempotent: if receipt already exists, return it.
   * If generation fails, sets receiptStatus = FAILED with error message.
   */
  async ensureReceiptForPayment(paymentId: string, excludeUserId?: string): Promise<ReceiptData | null> {
    try {
      const receipt = await this.prisma.$transaction(async (tx) => {
        await acquirePaymentReceiptLock(tx, paymentId);

        const payment = await tx.payment.findUnique({
          where: { id: paymentId },
          include: {
            unit: true,
            building: true,
            createdByUser: true,
            paymentAllocations: {
              include: {
                charge: {
                  include: {
                    expensePeriod: true,
                  },
                },
              },
            },
          },
        });

        if (!payment) {
          this.logger.error(`Payment ${paymentId} not found`);
          return null;
        }

        // Idempotency: if receipt already exists, return it
        if (payment.receiptDocumentId && payment.receiptNumber) {
          this.logger.log(`Receipt already exists for payment ${paymentId}, reusing ${payment.receiptNumber}`);
          const document = await tx.document.findUnique({
            where: { id: payment.receiptDocumentId },
            include: { file: true },
          });

          if (document?.file) {
            return {
              payment,
              receiptNumber: payment.receiptNumber,
              documentId: payment.receiptDocumentId,
              fileKey: document.file.objectKey,
              bucket: document.file.bucket,
              wasGenerated: false,
              approvedByUserName: 'Administración',
            };
          }
        }

        let approvedByUserName = 'Administración';
        if (payment.approvedByUserId) {
          const approvedByUser = await tx.user.findUnique({
            where: { id: payment.approvedByUserId },
            select: { name: true },
          });
          approvedByUserName = approvedByUser?.name || 'Administración';
        }

        const receiptNumber = await this.reserveReceiptNumberInTransaction(tx, payment.tenantId);
        const tenant = await tx.tenant.findUnique({
          where: { id: payment.tenantId },
          select: { name: true, brandName: true },
        });
        const tenantDisplayName = tenant?.brandName || tenant?.name || 'Consorcio';

        const pdfContent = await this.generateReceiptPDF(
          payment,
          receiptNumber,
          approvedByUserName,
          tenantDisplayName,
        );

        const objectKey = `tenant/${payment.tenantId}/payments/${paymentId}/receipt_${receiptNumber}.pdf`;
        await this.minio.uploadBuffer(this.bucket, objectKey, pdfContent, 'application/pdf');

        const file = await tx.file.create({
          data: {
            tenantId: payment.tenantId,
            bucket: this.bucket,
            objectKey,
            originalName: `receipt_${receiptNumber}.pdf`,
            mimeType: 'application/pdf',
            size: pdfContent.length,
          },
        });

        const document = await tx.document.create({
          data: {
            tenantId: payment.tenantId,
            fileId: file.id,
            title: `Recibo de pago ${receiptNumber}`,
            category: DocumentCategory.RECEIPT,
            visibility: DocumentVisibility.RESIDENTS,
            buildingId: payment.buildingId,
            unitId: payment.unitId,
          },
        });

        await tx.payment.update({
          where: { id: paymentId },
          data: {
            receiptDocumentId: document.id,
            receiptNumber,
            receiptStatus: ReceiptStatus.READY,
            receiptGeneratedAt: new Date(),
            receiptError: null,
          },
        });

        await tx.paymentAuditLog.create({
          data: {
            tenantId: payment.tenantId,
            paymentId,
            action: 'RECEIPT_GENERATED',
            metadata: {
              receiptNumber,
              documentId: document.id,
              objectKey,
            },
          },
        });

        return {
          payment,
          receiptNumber,
          documentId: document.id,
          fileKey: objectKey,
          bucket: this.bucket,
          wasGenerated: true,
          approvedByUserName,
          tenantDisplayName,
        };
      });

      if (!receipt) {
        return null;
      }

      const url = await this.minio.presignDownload(receipt.bucket, receipt.fileKey, 3600);

      if (!receipt.wasGenerated) {
        return {
          receiptNumber: receipt.receiptNumber,
          documentId: receipt.documentId,
          fileKey: receipt.fileKey,
          bucket: this.bucket,
          url,
        };
      }

      // Notify resident
      await this.notifyResidentReceiptReady(
        receipt.payment,
        receipt.receiptNumber,
        url,
        receipt.approvedByUserName,
        excludeUserId,
      );

      this.logger.log(`Receipt ${receipt.receiptNumber} generated for payment ${paymentId}`);

      return {
        receiptNumber: receipt.receiptNumber,
        documentId: receipt.documentId,
        fileKey: receipt.fileKey,
        bucket: this.bucket,
        url,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate receipt for payment ${paymentId}: ${errorMessage}`);

      // Mark as failed
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          receiptStatus: ReceiptStatus.FAILED,
          receiptError: errorMessage,
        },
      });

      return null;
    }
  }

  /**
   * Reserve a sequential receipt number for the tenant/year.
   * Uses transaction to ensure atomic increment.
   */
  private async reserveReceiptNumberInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<string> {
    const year = new Date().getFullYear();

    // Get tenant for slug
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    const tenantSlug = tenant?.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 6) || tenantId.substring(0, 6);

    // Try to find existing sequence
    let sequence = await tx.receiptSequence.findUnique({
      where: {
        tenantId_year: { tenantId, year },
      },
    });

    if (!sequence) {
      // Create new sequence
      sequence = await tx.receiptSequence.create({
        data: {
          tenantId,
          year,
          lastNumber: 0,
        },
      });
    }

    // Increment
    const newNumber = sequence.lastNumber + 1;
    await tx.receiptSequence.update({
      where: { id: sequence.id },
      data: { lastNumber: newNumber, updatedAt: new Date() },
    });

    // Format: R-{TENANT}-{YYYY}-{000001}
    const paddedNumber = newNumber.toString().padStart(6, '0');
    return `R-${tenantSlug.toUpperCase()}-${year}-${paddedNumber}`;
  }

  /**
   * Generate receipt PDF content.
   */
  private async generateReceiptPDF(
    payment: PaymentReceiptPayment,
    receiptNumber: string,
    approvedByUserName: string,
    tenantDisplayName: string,
  ): Promise<Buffer> {
    const approvedAt = this.formatReceiptDate(payment.approvedAt ?? new Date());
    const unitLabel = payment.unit?.label || payment.unitId || 'N/A';
    const buildingName = payment.building?.name || 'Edificio';
    const currency = payment.currency || 'ARS';
    const amountFormatted = this.formatCurrencyForReceipt(payment.amount, currency);
    const allocations = payment.paymentAllocations?.length
      ? payment.paymentAllocations.map((alloc, index) => {
          const expensePeriod = alloc.charge?.expensePeriod;
          const period = expensePeriod
            ? `${expensePeriod.year}-${String(expensePeriod.month).padStart(2, '0')}`
            : alloc.charge?.period || 'N/A';
          const concept = alloc.charge?.concept || 'Cargo';
          return `${period} - ${concept} - ${this.formatCurrencyForReceipt(alloc.amount, currency)}`;
        })
      : ['Sin aplicación específica - saldo a favor'];
    const primaryPeriod = payment.paymentAllocations?.[0]
      ? (() => {
          const expensePeriod = payment.paymentAllocations[0].charge?.expensePeriod;
          return expensePeriod
            ? `${expensePeriod.year}-${String(expensePeriod.month).padStart(2, '0')}`
            : payment.paymentAllocations[0].charge?.period || 'N/A';
        })()
      : 'N/A';

    return this.buildReceiptPdfBuffer({
      tenantDisplayName,
      receiptNumber,
      approvedAt,
      approvedByUserName,
      unitLabel,
      buildingName,
      amountFormatted,
      method: payment.method,
      reference: payment.reference || 'N/A',
      primaryPeriod,
      allocations,
    });
  }

  private buildReceiptPdfBuffer(input: {
    tenantDisplayName: string;
    receiptNumber: string;
    approvedAt: string;
    approvedByUserName: string;
    unitLabel: string;
    buildingName: string;
    amountFormatted: string;
    method: string;
    reference: string;
    primaryPeriod: string;
    allocations: readonly string[];
  }): Buffer {
    const bodyLines = this.buildReceiptBodyLines(input);
    const allocationPages = this.chunkReceiptBodyLines(bodyLines);
    const contentStreams = allocationPages.map((pageLines, index) =>
      this.buildReceiptPageContent({
        ...input,
        lines: pageLines,
        pageIndex: index,
        pageCount: allocationPages.length,
      }),
    );

    return this.serializePdf(contentStreams);
  }

  private buildReceiptBodyLines(input: {
    tenantDisplayName: string;
    receiptNumber: string;
    approvedAt: string;
    approvedByUserName: string;
    unitLabel: string;
    buildingName: string;
    amountFormatted: string;
    method: string;
    reference: string;
    primaryPeriod: string;
    allocations: readonly string[];
  }): ReceiptPdfLine[] {
    const lines: ReceiptPdfLine[] = [];

    this.pushWrappedReceiptLine(lines, input.tenantDisplayName, 'title');
    this.pushBlankReceiptLine(lines);
    this.pushWrappedReceiptLine(lines, 'Recibo de pago aprobado', 'heading');
    this.pushWrappedReceiptLine(lines, `Emitido por la Administración del ${input.tenantDisplayName}`);
    this.pushBlankReceiptLine(lines);

    this.pushWrappedReceiptLine(lines, 'Datos del recibo', 'heading');
    this.pushWrappedReceiptLine(lines, `Número de recibo: ${input.receiptNumber}`);
    this.pushWrappedReceiptLine(lines, `Fecha de aprobación: ${input.approvedAt}`);
    this.pushWrappedReceiptLine(lines, `Aprobado por: ${input.approvedByUserName}`);
    this.pushBlankReceiptLine(lines);

    this.pushWrappedReceiptLine(lines, 'Datos del pago', 'heading');
    this.pushWrappedReceiptLine(lines, `Unidad: ${input.unitLabel}`);
    this.pushWrappedReceiptLine(lines, `Edificio: ${input.buildingName}`);
    this.pushWrappedReceiptLine(lines, `Monto: ${input.amountFormatted}`);
    this.pushWrappedReceiptLine(lines, `Método: ${input.method}`);
    this.pushWrappedReceiptLine(lines, `Referencia: ${input.reference}`);
    this.pushWrappedReceiptLine(lines, `Período aplicado: ${input.primaryPeriod}`);
    this.pushBlankReceiptLine(lines);

    this.pushWrappedReceiptLine(lines, 'Aplicación del pago', 'heading');
    const allocations = input.allocations.length > 0
      ? [...input.allocations]
      : ['Sin aplicación específica - saldo a favor'];
    for (const allocation of allocations) {
      this.pushWrappedReceiptLine(lines, allocation);
    }

    return lines;
  }

  private buildReceiptPageContent(input: {
    tenantDisplayName: string;
    receiptNumber: string;
    approvedAt: string;
    approvedByUserName: string;
    unitLabel: string;
    buildingName: string;
    amountFormatted: string;
    method: string;
    reference: string;
    primaryPeriod: string;
    lines: readonly ReceiptPdfLine[];
    pageIndex: number;
    pageCount: number;
  }): string {
    const lines = input.lines;
    const contentCommands: string[] = ['BT', '72 792 Td'];
    let currentFont = '';
    let currentLeading: number | null = null;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const renderedText = line.kind === 'heading' && line.text === 'Aplicación del pago' && input.pageIndex > 0
        ? 'Aplicación del pago (continuación)'
        : line.text;

      if (index > 0) {
        contentCommands.push('T*');
      }

      const fontCommand = line.kind === 'title'
        ? '/F2 18 Tf'
        : line.kind === 'heading'
          ? '/F2 12 Tf'
          : '/F1 11 Tf';
      const leading = line.kind === 'title'
        ? 22
        : line.kind === 'heading'
          ? 14
          : 14;

      if (currentFont !== fontCommand) {
        contentCommands.push(fontCommand);
        currentFont = fontCommand;
      }

      if (currentLeading !== leading) {
        contentCommands.push(`${leading} TL`);
        currentLeading = leading;
      }

      if (line.kind !== 'blank') {
        contentCommands.push(this.pdfText(renderedText));
      }
    }

    contentCommands.push('T*');
    if (input.pageIndex === input.pageCount - 1) {
      contentCommands.push('/F1 10 Tf', '12 TL');
      contentCommands.push(this.pdfText('Este documento es una constancia de pago y no constituye factura fiscal.'));
      contentCommands.push('T*');
      contentCommands.push(this.pdfText(`Documento generado por la Administración del ${input.tenantDisplayName}.`));
    } else {
      contentCommands.push('/F1 10 Tf', '12 TL');
      contentCommands.push(this.pdfText('Continúa en la siguiente página.'));
    }

    contentCommands.push('T*');
    contentCommands.push(this.pdfText(`Página ${input.pageIndex + 1} de ${input.pageCount}`));
    contentCommands.push('ET');
    return contentCommands.join('\n');
  }

  private chunkReceiptBodyLines(lines: readonly ReceiptPdfLine[]): ReceiptPdfLine[][] {
    const pages: ReceiptPdfLine[][] = [];
    for (let index = 0; index < lines.length; index += RECEIPT_PDF_MAX_BODY_LINES_PER_PAGE) {
      pages.push(lines.slice(index, index + RECEIPT_PDF_MAX_BODY_LINES_PER_PAGE));
    }

    return pages.length > 0 ? pages : [[{ text: 'Sin aplicación específica - saldo a favor', kind: 'body' }]];
  }

  private pushBlankReceiptLine(lines: ReceiptPdfLine[]): void {
    lines.push({ text: '', kind: 'blank' });
  }

  private pushWrappedReceiptLine(
    lines: ReceiptPdfLine[],
    text: string,
    kind: 'title' | 'heading' | 'body' = 'body',
  ): void {
    const wrappedLines = this.wrapReceiptText(text);
    for (const wrappedLine of wrappedLines) {
      lines.push({ text: wrappedLine, kind });
    }
  }

  private wrapReceiptText(text: string): string[] {
    const trimmedText = text.trim();
    if (!trimmedText) {
      return [''];
    }

    const words = trimmedText.split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const candidateLine = currentLine ? `${currentLine} ${word}` : word;
      if (this.measureReceiptTextWidth(candidateLine) <= RECEIPT_PDF_MAX_TEXT_WIDTH) {
        currentLine = candidateLine;
        continue;
      }

      if (currentLine) {
        lines.push(currentLine);
        currentLine = '';
      }

      if (this.measureReceiptTextWidth(word) <= RECEIPT_PDF_MAX_TEXT_WIDTH) {
        currentLine = word;
        continue;
      }

      const splitTokenLines = this.splitReceiptToken(word);
      for (let index = 0; index < splitTokenLines.length - 1; index += 1) {
        lines.push(splitTokenLines[index]!);
      }
      currentLine = splitTokenLines[splitTokenLines.length - 1] ?? '';
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.length > 0 ? lines : [''];
  }

  private splitReceiptToken(token: string): string[] {
    const lines: string[] = [];
    let currentLine = '';

    for (const character of token) {
      const candidateLine = `${currentLine}${character}`;
      if (this.measureReceiptTextWidth(candidateLine) <= RECEIPT_PDF_MAX_TEXT_WIDTH) {
        currentLine = candidateLine;
      } else {
        if (currentLine) {
          lines.push(currentLine);
        }
        currentLine = character;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.length > 0 ? lines : [token];
  }

  private measureReceiptTextWidth(text: string): number {
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
      '€': 5.5,
      '‘': 2.5,
      '’': 2.5,
      '“': 3.5,
      '”': 3.5,
      '–': 4.5,
      '—': 6,
      '…': 7,
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
        continue;
      }

      if (character.toUpperCase() === character && character.toLowerCase() !== character.toUpperCase()) {
        width += 6;
      } else {
        width += 5;
      }
    }

    return width;
  }

  private serializePdf(contentStreams: readonly string[]): Buffer {
    const pageCount = contentStreams.length;
    const fontObjectNumber = 3 + pageCount;
    const boldFontObjectNumber = 4 + pageCount;
    const contentStartObjectNumber = 5 + pageCount;
    const pageObjectNumbers = Array.from({ length: pageCount }, (_, index) => 3 + index);

    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      `<< /Type /Pages /Kids [${pageObjectNumbers.map((objectNumber) => `${objectNumber} 0 R`).join(' ')}] /Count ${pageCount} >>`,
      ...pageObjectNumbers.map((pageObjectNumber, index) => {
        const contentObjectNumber = contentStartObjectNumber + index;
        return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObjectNumber} 0 R /F2 ${boldFontObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`;
      }),
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      ...contentStreams.map((contentStreamText) => `<< /Length ${Buffer.byteLength(contentStreamText, 'latin1')} >>\nstream\n${contentStreamText}\nendstream`),
    ];

    const header = '%PDF-1.4\n%âãÏÓ\n';
    const objectBuffers = objects.map((body, index) => Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, 'latin1'));
    const offsets = ['0000000000 65535 f \n'];
    let offset = Buffer.byteLength(header, 'latin1');

    for (const objectBuffer of objectBuffers) {
      offsets.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
      offset += objectBuffer.length;
    }

    const xref = `xref\n0 ${objects.length + 1}\n${offsets.join('')}`;
    const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;

    return Buffer.concat([
      Buffer.from(header, 'latin1'),
      ...objectBuffers,
      Buffer.from(xref + trailer, 'latin1'),
    ]);
  }

  private pdfText(text: string): string {
    return `(${this.escapePdfText(this.encodeWinAnsi(text))}) Tj`;
  }

  private escapePdfText(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  private encodeWinAnsi(text: string): string {
    let encoded = '';

    for (const character of text) {
      const mappedCharacter = WIN_ANSI_CHAR_MAP[character];
      if (mappedCharacter) {
        encoded += mappedCharacter;
        continue;
      }

      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint >= 0x20 && codePoint <= 0x7E) {
        encoded += character;
        continue;
      }

      if (codePoint >= 0xA0 && codePoint <= 0xFF) {
        encoded += character;
        continue;
      }

      encoded += '?';
    }

    return encoded;
  }

  private formatCurrencyForReceipt(amountMinor: number, currency: string): string {
    const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : 'ARS';
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: safeCurrency,
      currencyDisplay: 'code',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amountMinor / 100);
  }

  private formatReceiptDate(dateValue: string | Date): string {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    return new Intl.DateTimeFormat('es-AR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date);
  }

  /**
   * Notify resident that their receipt is ready
   */
  private async notifyResidentReceiptReady(
    payment: PaymentReceiptPayment,
    receiptNumber: string,
    receiptUrl: string,
    approvedByUserName: string,
    excludeUserId?: string,
  ) {
    try {
      if (excludeUserId && payment.createdByUserId === excludeUserId) {
        return;
      }

      await this.notificationsService.createNotification({
        tenantId: payment.tenantId,
        userId: payment.createdByUserId,
        type: 'PAYMENT_RECEIVED',
        title: '💰 Tu pago fue aprobado - Recibo disponible',
        body: `Tu pago de ${(payment.amount / 100).toFixed(2)} ${payment.currency} ha sido aprobado. El recibo ${receiptNumber} está disponible para descargar.`,
        data: {
          event: 'PAYMENT_RECEIPT_READY',
          paymentId: payment.id,
          receiptNumber,
          receiptUrl,
          amount: payment.amount / 100,
          currency: payment.currency,
          approvedBy: approvedByUserName,
        },
        deliveryMethods: ['IN_APP', 'EMAIL'],
      });
    } catch (error) {
      this.logger.warn(`Failed to notify resident about receipt: ${error}`);
    }
  }
}
