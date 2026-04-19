import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../storage/minio.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Payment, ReceiptStatus, DocumentCategory, DocumentVisibility } from '@prisma/client';

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

@Injectable()
export class PaymentReceiptService {
  private readonly logger = new Logger(PaymentReceiptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly notificationsService: NotificationsService,
  ) {}

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
        const url = await this.minio.presignDownload('documents', document.file.objectKey, 3600);
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
      const pdfContent = await this.generateReceiptPDF(payment, receiptNumber);

      // Save to storage
      const objectKey = `tenant/${payment.tenantId}/payments/${paymentId}/receipt_${receiptNumber}.pdf`;
      await this.minio.uploadBuffer('documents', objectKey, pdfContent, 'application/pdf');

      // Create File record
      const file = await this.prisma.file.create({
        data: {
          tenantId: payment.tenantId,
          bucket: 'documents',
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

      const url = await this.minio.presignDownload('documents', objectKey, 3600);

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
   * Currently returns simple text - can be upgraded to proper PDF library later.
   */
  private async generateReceiptPDF(payment: any, receiptNumber: string): Promise<Buffer> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: payment.tenantId },
      select: { name: true, brandName: true },
    });
    const tenantDisplayName = tenant?.brandName || tenant?.name || 'Consorcio';

    const approvedBy = payment.approvedByUser?.name || 'Administración';
    const approvedAt = payment.approvedAt 
      ? new Date(payment.approvedAt).toLocaleString('es-AR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : new Date().toLocaleString('es-AR');

    const unitLabel = payment.unit?.label || payment.unitId || 'N/A';
    const buildingName = payment.building?.name || 'Edificio';
    const amountFormatted = (payment.amount / 100).toFixed(2);
    const currency = payment.currency || 'ARS';

    // Build allocations text
    let allocationsText = '';
    if (payment.paymentAllocations && payment.paymentAllocations.length > 0) {
      allocationsText = payment.paymentAllocations
        .map((alloc: any) => {
          const period = alloc.charge?.expensePeriod?.period || alloc.charge?.period || 'N/A';
          const concept = alloc.charge?.concept || 'Cargo';
          const amount = (alloc.amount / 100).toFixed(2);
          return `  - ${period}: ${concept} = ${currency} ${amount}`;
        })
        .join('\n');
    } else {
      allocationsText = '  (Sin aplicación específica - saldo a favor)';
    }

    const content = `
================================================================================
                         ${tenantDisplayName.toUpperCase()}
================================================================================

RECIBO DE PAGO APROBADO
--------------------------------------------------------------------------------
Número de recibo: ${receiptNumber}
Fecha de aprobación: ${approvedAt}

DATOS DEL PAGO
--------------------------------------------------------------------------------
Unidad: ${unitLabel}
Edificio: ${buildingName}
Monto: ${currency} ${amountFormatted}
Método: ${payment.method}
Referencia: ${payment.reference || 'N/A'}

APLICACIÓN DEL PAGO
--------------------------------------------------------------------------------
${allocationsText}

================================================================================
Aprobado por: ${approvedBy}
Este documento es una CONSTANCIA DE PAGO, no constituye factura fiscal.
================================================================================
    `.trim();

    return Buffer.from(content, 'utf-8');
  }

  /**
   * Notify resident that their receipt is ready
   */
  private async notifyResidentReceiptReady(
    payment: any,
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