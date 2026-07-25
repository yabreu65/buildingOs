import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../storage/minio.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DocumentCategory, DocumentVisibility, Prisma, ReceiptStatus } from '@prisma/client';

export interface GenerateReceiptInput {
  paymentId: string;
  tenantId: string;
}

export interface ReceiptData {
  receiptNumber: string;
  documentId: string;
  fileKey: string;
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
  async ensureReceiptForPayment(paymentId: string): Promise<ReceiptData | null> {
    const payment = await this.prisma.payment.findUnique({
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

    // Get approvedByUser separately
    let approvedByUserName = 'Administración';
    if (payment?.approvedByUserId) {
      const approvedByUser = await this.prisma.user.findUnique({
        where: { id: payment.approvedByUserId },
        select: { name: true },
      });
      approvedByUserName = approvedByUser?.name || 'Administración';
    }

    if (!payment) {
      this.logger.error(`Payment ${paymentId} not found`);
      return null;
    }

    // Idempotency: if receipt already exists, return it
    if (payment.receiptDocumentId && payment.receiptNumber) {
      this.logger.log(`Receipt already exists for payment ${paymentId}, reusing ${payment.receiptNumber}`);
      const document = await this.prisma.document.findUnique({
        where: { id: payment.receiptDocumentId },
        include: { file: true },
      });

      if (document?.file) {
        const url = await this.minio.presignDownload(document.file.bucket, document.file.objectKey, 3600);
        return {
          receiptNumber: payment.receiptNumber,
          documentId: payment.receiptDocumentId,
          fileKey: document.file.objectKey,
          url,
        };
      }
    }

    try {
      // Generate receipt number
      const receiptNumber = await this.reserveReceiptNumber(payment.tenantId);

      // Generate PDF content (for now, simple text - can be upgraded to proper PDF later)
      const pdfContent = await this.generateReceiptPDF(
        payment,
        receiptNumber,
        approvedByUserName,
      );

      // Save to storage
      const objectKey = `tenant/${payment.tenantId}/payments/${paymentId}/receipt_${receiptNumber}.pdf`;
      await this.minio.uploadBuffer(this.bucket, objectKey, pdfContent, 'application/pdf');

      // Create File record
      const file = await this.prisma.file.create({
        data: {
          tenantId: payment.tenantId,
          bucket: this.bucket,
          objectKey,
          originalName: `receipt_${receiptNumber}.pdf`,
          mimeType: 'application/pdf',
          size: pdfContent.length,
        },
      });

      // Get tenant info
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: payment.tenantId },
        select: { name: true, brandName: true },
      });
      const tenantDisplayName = tenant?.brandName || tenant?.name || 'Consorcio';

      // Create Document record (RECEIPT category, RESIDENTS visibility for admin+resident access)
      const document = await this.prisma.document.create({
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

      // Update payment with receipt info
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          receiptDocumentId: document.id,
          receiptNumber,
          receiptStatus: ReceiptStatus.READY,
          receiptGeneratedAt: new Date(),
          receiptError: null,
        },
      });

      // Audit log
      await this.prisma.paymentAuditLog.create({
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

      const url = await this.minio.presignDownload(this.bucket, objectKey, 3600);

      // Notify resident
      await this.notifyResidentReceiptReady(payment, receiptNumber, url, approvedByUserName);

      this.logger.log(`Receipt ${receiptNumber} generated for payment ${paymentId}`);

      return {
        receiptNumber,
        documentId: document.id,
        fileKey: objectKey,
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
  private async reserveReceiptNumber(tenantId: string): Promise<string> {
    const year = new Date().getFullYear();

    // Get tenant for slug
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    const tenantSlug = tenant?.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 6) || tenantId.substring(0, 6);

    // Atomic increment using transaction
    const result = await this.prisma.$transaction(async (tx) => {
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

      return newNumber;
    });

    // Format: R-{TENANT}-{YYYY}-{000001}
    const paddedNumber = result.toString().padStart(6, '0');
    return `R-${tenantSlug.toUpperCase()}-${year}-${paddedNumber}`;
  }

  /**
   * Generate receipt PDF content.
   */
  private async generateReceiptPDF(
    payment: PaymentReceiptPayment,
    receiptNumber: string,
    approvedByUserName: string,
  ): Promise<Buffer> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: payment.tenantId },
      select: { name: true, brandName: true },
    });
    const tenantDisplayName = tenant?.brandName || tenant?.name || 'Consorcio';

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
    const allocations = input.allocations.length > 0
      ? [...input.allocations]
      : ['Sin aplicación específica - saldo a favor'];
    const allocationPages = this.chunkReceiptAllocations(allocations);
    const contentStreams = allocationPages.map((allocationPage, index) =>
      this.buildReceiptPageContent({
        ...input,
        allocations: allocationPage,
        pageIndex: index,
        pageCount: allocationPages.length,
      }),
    );

    return this.serializePdf(contentStreams);
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
    allocations: readonly string[];
    pageIndex: number;
    pageCount: number;
  }): string {
    const contentCommands = [
      'BT',
      '/F2 18 Tf',
      '22 TL',
      '72 792 Td',
      this.pdfText(input.tenantDisplayName),
      '/F1 11 Tf',
      '14 TL',
      'T*',
      this.pdfText('Recibo de pago aprobado'),
      'T*',
      this.pdfText(`Emitido por la Administración del ${input.tenantDisplayName}`),
      'T*',
      'T*',
      '/F2 12 Tf',
      this.pdfText('Datos del recibo'),
      '/F1 11 Tf',
      '14 TL',
      'T*',
      this.pdfText(`Número de recibo: ${input.receiptNumber}`),
      'T*',
      this.pdfText(`Fecha de aprobación: ${input.approvedAt}`),
      'T*',
      this.pdfText(`Aprobado por: ${input.approvedByUserName}`),
      'T*',
      'T*',
      '/F2 12 Tf',
      this.pdfText('Datos del pago'),
      '/F1 11 Tf',
      '14 TL',
      'T*',
      this.pdfText(`Unidad: ${input.unitLabel}`),
      'T*',
      this.pdfText(`Edificio: ${input.buildingName}`),
      'T*',
      this.pdfText(`Monto: ${input.amountFormatted}`),
      'T*',
      this.pdfText(`Método: ${input.method}`),
      'T*',
      this.pdfText(`Referencia: ${input.reference}`),
      'T*',
      this.pdfText(`Período aplicado: ${input.primaryPeriod}`),
      'T*',
      'T*',
      '/F2 12 Tf',
      this.pdfText(input.pageCount > 1 && input.pageIndex > 0 ? 'Aplicación del pago (continuación)' : 'Aplicación del pago'),
      '/F1 11 Tf',
      '14 TL',
      ...input.allocations.flatMap((allocation) => [
        'T*',
        this.pdfText(allocation),
      ]),
      'T*',
    ];

    if (input.pageIndex === input.pageCount - 1) {
      contentCommands.push(
        this.pdfText('Este documento es una constancia de pago y no constituye factura fiscal.'),
        'T*',
        this.pdfText(`Documento generado por la Administración del ${input.tenantDisplayName}.`),
      );
    } else {
      contentCommands.push(
        this.pdfText('Continúa en la siguiente página.'),
      );
    }

    contentCommands.push('ET');
    return contentCommands.join('\n');
  }

  private chunkReceiptAllocations(allocations: readonly string[]): string[][] {
    const chunkSize = 8;
    const pages: string[][] = [];

    for (let index = 0; index < allocations.length; index += chunkSize) {
      pages.push(allocations.slice(index, index + chunkSize));
    }

    return pages.length > 0 ? pages : [['Sin aplicación específica - saldo a favor']];
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
    return `(${this.escapePdfText(text)}) Tj`;
  }

  private escapePdfText(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
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
  ) {
    try {
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
