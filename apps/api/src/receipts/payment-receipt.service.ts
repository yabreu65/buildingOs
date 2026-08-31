import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { MinioObjectStat, MinioService } from "../storage/minio.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  DocumentCategory,
  DocumentVisibility,
  Prisma,
  ReceiptStatus,
} from "@prisma/client";
import {
  acquirePaymentReceiptLock,
  acquireReceiptSequenceLock,
} from "../common/payment-linked-document-lock";

const RECEIPT_GENERATION_SAFE_ERROR =
  "No pudimos generar el comprobante. Intenta nuevamente más tarde.";
const RECEIPT_MIME_TYPE = "application/pdf";
const MAX_RECEIPT_OBJECT_BYTES = 10 * 1024 * 1024;
const RECEIPT_SNAPSHOT_VERSION = "PAYMENT_RECEIPT_V1";
const RECEIPT_GENERATION_LEASE_MS = 5 * 60 * 1000;
const RECEIPT_GENERATION_HEARTBEAT_INTERVAL_MS = Math.floor(
  RECEIPT_GENERATION_LEASE_MS / 3,
);
const RECEIPT_GENERATION_WAIT_TIMEOUT_MS = 2_000;
const RECEIPT_GENERATION_WAIT_INTERVAL_MS = 100;

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

type ReceiptDocumentWithFile = Prisma.DocumentGetPayload<{
  include: { file: true };
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

interface ReceiptSnapshotAllocation {
  readonly period: string;
  readonly concept: string;
  readonly amountMinor: number;
  readonly amountFormatted: string;
  readonly line: string;
}

interface ReceiptSnapshot {
  readonly version: string;
  readonly tenantId: string;
  readonly paymentId: string;
  readonly receiptNumber: string;
  readonly buildingId: string;
  readonly unitId: string | null;
  readonly tenantDisplayName: string;
  readonly buildingName: string;
  readonly unitLabel: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly amountFormatted: string;
  readonly method: string;
  readonly reference: string;
  readonly approvedAt: string | null;
  readonly approvedAtFormatted: string;
  readonly approvedByUserName: string;
  readonly primaryPeriod: string;
  readonly allocations: readonly ReceiptSnapshotAllocation[];
  readonly allocationLines: readonly string[];
}

interface PreparedReceiptGeneration {
  payment: PaymentReceiptPayment;
  receiptNumber: string;
  fileKey: string;
  bucket: string;
  snapshot?: ReceiptSnapshot;
  documentId?: string;
  existingFile?: ReceiptFileArtifact;
  auditExists: boolean;
  generationToken?: string;
  legacyReady: boolean;
  shouldNotify: boolean;
}

interface LegacyReservedOnlyCandidate {
  readonly kind: "LEGACY_RESERVED_ONLY";
  readonly payment: PaymentReceiptPayment;
  readonly receiptNumber: string;
  readonly fileKey: string;
  readonly bucket: string;
}

type ReceiptPreparation = PreparedReceiptGeneration | LegacyReservedOnlyCandidate | null;

interface FinalizedReceipt extends PreparedReceiptGeneration {
  documentId: string;
  wasGenerated: boolean;
  shouldNotify: boolean;
}

interface ReceiptFileArtifact {
  readonly id: string;
  readonly tenantId: string;
  readonly bucket: string;
  readonly objectKey: string;
  readonly size: number;
  readonly mimeType: string;
  readonly checksum: string | null;
}

interface ReceiptStorageMetadata {
  readonly bucket: string;
  readonly objectKey: string;
  readonly mimeType: string;
  readonly size: number;
  readonly checksum: string;
}

interface ReceiptGenerationHeartbeat {
  assertOwned(): void;
  stop(): Promise<void>;
}

class ReceiptConsistencyError extends Error {}
class ReceiptLeaseLostError extends Error {}
class ReceiptGenerationInProgressError extends Error {}

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
   * If generation fails before confirmation, sets receiptStatus = FAILED with error message.
   */
  async ensureReceiptForPayment(
    tenantId: string,
    paymentId: string,
    excludeUserId?: string,
  ): Promise<ReceiptData | null> {
    let preparedReceipt: PreparedReceiptGeneration | null = null;
    try {
      const preparation = await this.prepareReceiptGeneration(
        tenantId,
        paymentId,
      );

      if (!preparation) {
        return null;
      }

      if (this.isLegacyReservedOnlyCandidate(preparation)) {
        if (await this.minio.objectExists(preparation.bucket, preparation.fileKey)) {
          throw new ReceiptConsistencyError(
            `Legacy receipt ${preparation.receiptNumber} has a canonical storage object without an issuance snapshot`,
          );
        }
        preparedReceipt = await this.prepareLegacyReservedOnlyGeneration(
          tenantId,
          paymentId,
          preparation,
        );
        if (!preparedReceipt) {
          return null;
        }
      } else {
        preparedReceipt = preparation;
      }

      if (preparedReceipt.legacyReady) {
        if (
          !preparedReceipt.existingFile ||
          !preparedReceipt.auditExists ||
          !(await this.isCompleteStorageArtifact(preparedReceipt.existingFile))
        ) {
          throw new ReceiptConsistencyError(
            `Legacy receipt ${preparedReceipt.receiptNumber} has no trustworthy snapshot or complete artifact`,
          );
        }
        const url = await this.minio.presignDownload(preparedReceipt.bucket, preparedReceipt.fileKey, 3600);

        return {
          receiptNumber: preparedReceipt.receiptNumber,
          documentId: preparedReceipt.documentId!,
          fileKey: preparedReceipt.fileKey,
          bucket: preparedReceipt.bucket,
          url,
        };
      }

      if (!preparedReceipt.snapshot || !preparedReceipt.generationToken) {
        return null;
      }

      const heartbeat = this.startReceiptGenerationHeartbeat(
        tenantId,
        paymentId,
        preparedReceipt.generationToken,
      );
      let finalizedReceipt: FinalizedReceipt;
      try {
        heartbeat.assertOwned();
        const pdfContent = this.generateReceiptPdfFromSnapshot(preparedReceipt.snapshot);
        const expectedChecksum = this.sha256(pdfContent);
        heartbeat.assertOwned();
        const storageMetadata = await this.ensureReceiptStorageObject(
          preparedReceipt.bucket,
          preparedReceipt.fileKey,
          pdfContent,
        );
        heartbeat.assertOwned();
        finalizedReceipt = await this.finalizeReceipt(
          tenantId,
          preparedReceipt,
          storageMetadata,
          pdfContent.length,
          expectedChecksum,
        );
      } finally {
        await heartbeat.stop();
      }

      const url = await this.minio.presignDownload(finalizedReceipt.bucket, finalizedReceipt.fileKey, 3600);

      if (finalizedReceipt.shouldNotify) {
        // Receipt persistence is authoritative; delivery remains best-effort outside the transaction.
        await this.notifyResidentReceiptReady(
          finalizedReceipt.payment,
          finalizedReceipt.receiptNumber,
          url,
          finalizedReceipt.snapshot!.approvedByUserName,
          excludeUserId,
        );

        this.logger.log(
          `Receipt ${finalizedReceipt.receiptNumber} generated for payment ${paymentId}`,
        );
      }

      return {
        receiptNumber: finalizedReceipt.receiptNumber,
        documentId: finalizedReceipt.documentId,
        fileKey: finalizedReceipt.fileKey,
        bucket: finalizedReceipt.bucket,
        url,
      };
    } catch (error) {
      if (error instanceof ReceiptGenerationInProgressError) {
        const completedReceipt = await this.waitForReceiptGeneration(
          tenantId,
          paymentId,
          excludeUserId,
        );
        if (completedReceipt) {
          return completedReceipt;
        }
        throw new ConflictException("RECEIPT_GENERATION_IN_PROGRESS");
      }

      const rawMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate receipt for payment ${paymentId}: ${rawMessage}`);

      await this.markReceiptGenerationFailedIfNeeded(
        tenantId,
        paymentId,
        RECEIPT_GENERATION_SAFE_ERROR,
        preparedReceipt?.generationToken,
      );

      if (error instanceof ReceiptConsistencyError) {
        throw new ConflictException(rawMessage);
      }

      return null;
    }
  }

  private async prepareReceiptGeneration(
    tenantId: string,
    paymentId: string,
  ): Promise<ReceiptPreparation> {
    return this.prisma.$transaction(async (tx) => {
      await acquirePaymentReceiptLock(tx, paymentId);

      const payment = await this.loadPaymentForReceipt(tx, tenantId, paymentId);

      if (!payment) {
        this.logger.error(`Payment ${paymentId} not found`);
        return null;
      }

      if (!this.isReceiptEligible(payment)) {
        return null;
      }

      const existingDocument = payment.receiptDocumentId
        ? await this.loadReceiptDocument(
            tx,
            tenantId,
            payment.receiptDocumentId,
          )
        : null;

      if (payment.receiptDocumentId && !existingDocument) {
        throw new ReceiptConsistencyError(
          `Receipt document ${payment.receiptDocumentId} is missing or belongs to another tenant`,
        );
      }
      if (existingDocument && !payment.receiptNumber) {
        throw new ReceiptConsistencyError(
          `Receipt document ${existingDocument.id} has no receipt number`,
        );
      }
      if (
        existingDocument &&
        !this.isReceiptDocumentIdentityValid(
          existingDocument,
          payment,
          payment.receiptNumber!,
        )
      ) {
        throw new ReceiptConsistencyError(
          `Receipt document ${existingDocument.id} is inconsistent with payment ${paymentId}`,
        );
      }
      const snapshot = this.getVerifiedReceiptSnapshot(payment);
      const auditExists = await this.receiptAuditExists(tx, tenantId, paymentId);

      if (payment.receiptNumber && !snapshot) {
        if (
          payment.receiptStatus === ReceiptStatus.READY &&
          existingDocument?.file
        ) {
          return {
            payment,
            receiptNumber: payment.receiptNumber,
            fileKey: existingDocument.file.objectKey,
            bucket: existingDocument.file.bucket,
            documentId: existingDocument.id,
            existingFile: existingDocument.file,
            auditExists,
            legacyReady: true,
            shouldNotify: false,
          };
        }
        if (
          await this.isLegacyReservedOnlyDatabaseState(
            tx,
            payment,
            existingDocument,
            auditExists,
          )
        ) {
          const fileKey = this.buildReceiptObjectKey(
            payment.tenantId,
            payment.id,
            payment.receiptNumber,
          );
          return {
            kind: "LEGACY_RESERVED_ONLY",
            payment,
            receiptNumber: payment.receiptNumber,
            fileKey,
            bucket: this.bucket,
          };
        }
        throw new ReceiptConsistencyError(
          `Receipt ${payment.receiptNumber} cannot be regenerated without an issuance snapshot`,
        );
      }

      if (payment.receiptStatus === ReceiptStatus.READY) {
        if (!payment.receiptNumber || !existingDocument?.file || !snapshot) {
          throw new ReceiptConsistencyError(
            `Payment ${paymentId} is READY without a complete issuance snapshot and receipt document`,
          );
        }
        return this.claimReceiptGenerationInTransaction(
          tx,
          tenantId,
          payment,
          snapshot,
          existingDocument,
          false,
        );
      }

      if (snapshot) {
        if (!payment.receiptNumber) {
          throw new ReceiptConsistencyError(
            `Payment ${paymentId} has an issuance snapshot without a receipt number`,
          );
        }
        return this.claimReceiptGenerationInTransaction(
          tx,
          tenantId,
          payment,
          snapshot,
          existingDocument,
          true,
        );
      }

      if (
        payment.receiptNumber ||
        payment.receiptDocumentId ||
        payment.receiptGeneratedAt
      ) {
        throw new ReceiptConsistencyError(
          `Payment ${paymentId} has historical receipt evidence without an issuance snapshot`,
        );
      }

      const receiptNumber = await this.reserveReceiptNumberInTransaction(
        tx,
        payment.tenantId,
      );
      const fileKey = this.buildReceiptObjectKey(
        payment.tenantId,
        paymentId,
        receiptNumber,
      );

      const conflictingFile = await tx.file.findFirst({
        where: {
          tenantId: payment.tenantId,
          bucket: this.bucket,
          objectKey: fileKey,
        },
        select: { id: true },
      });
      if (conflictingFile) {
        throw new ReceiptConsistencyError(
          `Receipt storage key ${this.bucket}/${fileKey} already has a database File`,
        );
      }

      const databaseNow = await this.getDatabaseNow(tx);
      const tenant = await tx.tenant.findUnique({
        where: { id: payment.tenantId },
        select: { name: true, brandName: true },
      });
      const approvedByUser = payment.approvedByUserId
        ? await tx.user.findUnique({
            where: { id: payment.approvedByUserId },
            select: { name: true },
          })
        : null;
      const snapshotCreatedAt = databaseNow;
      const newSnapshot = this.createReceiptSnapshot(
        payment,
        receiptNumber,
        tenant?.brandName || tenant?.name || "Consorcio",
        approvedByUser?.name || "Administración",
        snapshotCreatedAt,
      );
      const generationToken = randomUUID();
      const leaseUntil = this.addLeaseDuration(databaseNow);

      await tx.payment.update({
        where: { id: paymentId, tenantId },
        data: {
          receiptNumber,
          receiptSnapshot: this.toPrismaReceiptSnapshot(newSnapshot),
          receiptSnapshotVersion: RECEIPT_SNAPSHOT_VERSION,
          receiptSnapshotHash: this.hashReceiptSnapshot(newSnapshot),
          receiptSnapshotCreatedAt: snapshotCreatedAt,
          receiptStatus: ReceiptStatus.PENDING,
          receiptGeneratedAt: null,
          receiptError: null,
          receiptGenerationToken: generationToken,
          receiptGenerationLeaseUntil: leaseUntil,
        },
      });
      return this.buildPreparedReceipt(
        payment,
        newSnapshot,
        receiptNumber,
        this.bucket,
        fileKey,
        undefined,
        undefined,
        false,
        true,
        generationToken,
      );
    });
  }

  private isLegacyReservedOnlyCandidate(
    preparation: ReceiptPreparation,
  ): preparation is LegacyReservedOnlyCandidate {
    return (
      preparation !== null &&
      "kind" in preparation &&
      preparation.kind === "LEGACY_RESERVED_ONLY"
    );
  }

  private async isLegacyReservedOnlyDatabaseState(
    tx: Prisma.TransactionClient,
    payment: PaymentReceiptPayment,
    existingDocument: ReceiptDocumentWithFile | null,
    auditExists: boolean,
  ): Promise<boolean> {
    if (
      payment.receiptSnapshot !== null &&
      payment.receiptSnapshot !== undefined
    ) {
      return false;
    }
    if (
      !payment.receiptNumber ||
      (payment.receiptStatus !== ReceiptStatus.PENDING &&
        payment.receiptStatus !== ReceiptStatus.FAILED) ||
      existingDocument ||
      payment.receiptDocumentId ||
      payment.receiptGeneratedAt ||
      payment.receiptGenerationToken ||
      payment.receiptGenerationLeaseUntil ||
      auditExists
    ) {
      return false;
    }

    const canonicalFile = await tx.file.findFirst({
      where: {
        tenantId: payment.tenantId,
        bucket: this.bucket,
        objectKey: this.buildReceiptObjectKey(
          payment.tenantId,
          payment.id,
          payment.receiptNumber,
        ),
      },
      select: { id: true },
    });
    return canonicalFile === null;
  }

  private async prepareLegacyReservedOnlyGeneration(
    tenantId: string,
    paymentId: string,
    candidate: LegacyReservedOnlyCandidate,
  ): Promise<PreparedReceiptGeneration | null> {
    return this.prisma.$transaction(async (tx) => {
      await acquirePaymentReceiptLock(tx, paymentId);

      const payment = await this.loadPaymentForReceipt(tx, tenantId, paymentId);
      if (!payment || !this.isReceiptEligible(payment)) {
        return null;
      }

      const existingDocument = payment.receiptDocumentId
        ? await this.loadReceiptDocument(tx, tenantId, payment.receiptDocumentId)
        : null;
      if (payment.receiptDocumentId && !existingDocument) {
        throw new ReceiptConsistencyError(
          `Receipt document ${payment.receiptDocumentId} is missing or belongs to another tenant`,
        );
      }
      const snapshot = this.getVerifiedReceiptSnapshot(payment);
      if (snapshot) {
        if (!payment.receiptNumber) {
          throw new ReceiptConsistencyError(
            `Payment ${payment.id} has an issuance snapshot without a receipt number`,
          );
        }
        return this.claimReceiptGenerationInTransaction(
          tx,
          tenantId,
          payment,
          snapshot,
          existingDocument,
          true,
        );
      }

      const auditExists = await this.receiptAuditExists(tx, tenantId, paymentId);
      const stillReservedOnly = await this.isLegacyReservedOnlyDatabaseState(
        tx,
        payment,
        existingDocument,
        auditExists,
      );
      if (
        !stillReservedOnly ||
        payment.receiptNumber !== candidate.receiptNumber
      ) {
        throw new ReceiptConsistencyError(
          `Legacy receipt ${candidate.receiptNumber} changed before retry and cannot be safely reconstructed`,
        );
      }

      const databaseNow = await this.getDatabaseNow(tx);
      const tenant = await tx.tenant.findUnique({
        where: { id: payment.tenantId },
        select: { name: true, brandName: true },
      });
      const approvedByUser = payment.approvedByUserId
        ? await tx.user.findUnique({
            where: { id: payment.approvedByUserId },
            select: { name: true },
          })
        : null;
      const newSnapshot = this.createReceiptSnapshot(
        payment,
        candidate.receiptNumber,
        tenant?.brandName || tenant?.name || "Consorcio",
        approvedByUser?.name || "Administración",
        databaseNow,
      );
      const generationToken = randomUUID();
      const updated = await tx.payment.updateMany({
        where: {
          id: paymentId,
          tenantId,
          receiptNumber: candidate.receiptNumber,
          receiptSnapshot: { equals: Prisma.DbNull },
          receiptDocumentId: null,
          receiptGeneratedAt: null,
          receiptGenerationToken: null,
          receiptGenerationLeaseUntil: null,
        },
        data: {
          receiptSnapshot: this.toPrismaReceiptSnapshot(newSnapshot),
          receiptSnapshotVersion: RECEIPT_SNAPSHOT_VERSION,
          receiptSnapshotHash: this.hashReceiptSnapshot(newSnapshot),
          receiptSnapshotCreatedAt: databaseNow,
          receiptStatus: ReceiptStatus.PENDING,
          receiptError: null,
          receiptGenerationToken: generationToken,
          receiptGenerationLeaseUntil: this.addLeaseDuration(databaseNow),
        },
      });
      if (updated.count !== 1) {
        throw new ReceiptConsistencyError(
          `Legacy receipt ${candidate.receiptNumber} changed before snapshot creation`,
        );
      }

      return this.buildPreparedReceipt(
        payment,
        newSnapshot,
        candidate.receiptNumber,
        candidate.bucket,
        candidate.fileKey,
        undefined,
        undefined,
        false,
        true,
        generationToken,
      );
    });
  }

  private async claimReceiptGenerationInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    payment: PaymentReceiptPayment,
    snapshot: ReceiptSnapshot,
    existingDocument: ReceiptDocumentWithFile | null,
    shouldNotify: boolean,
  ): Promise<PreparedReceiptGeneration | null> {
    const now = await this.getDatabaseNow(tx);
    if (
      payment.receiptGenerationToken &&
      payment.receiptGenerationLeaseUntil &&
      payment.receiptGenerationLeaseUntil > now
    ) {
      throw new ReceiptGenerationInProgressError(
        `Receipt generation is already in progress for payment ${payment.id}`,
      );
    }

    const generationToken = randomUUID();
    const leaseUntil = this.addLeaseDuration(now);
    await tx.payment.update({
      where: { id: payment.id, tenantId },
      data: {
        receiptGenerationToken: generationToken,
        receiptGenerationLeaseUntil: leaseUntil,
        ...(payment.receiptStatus === ReceiptStatus.READY
          ? {}
          : {
              receiptStatus: ReceiptStatus.PENDING,
              receiptGeneratedAt: null,
              receiptError: null,
            }),
      },
    });

    return this.buildPreparedReceipt(
      payment,
      snapshot,
      payment.receiptNumber!,
      this.bucket,
      this.buildReceiptObjectKey(tenantId, payment.id, payment.receiptNumber!),
      existingDocument?.id,
      existingDocument?.file,
      await this.receiptAuditExists(tx, tenantId, payment.id),
      shouldNotify,
      generationToken,
    );
  }

  private async finalizeReceipt(
    tenantId: string,
    preparedReceipt: PreparedReceiptGeneration,
    storageMetadata: ReceiptStorageMetadata,
    expectedSize: number,
    expectedChecksum: string,
  ): Promise<FinalizedReceipt> {
    return this.prisma.$transaction(async (tx) => {
      await acquirePaymentReceiptLock(tx, preparedReceipt.payment.id);

      const currentPayment = await this.loadPaymentForReceipt(
        tx,
        tenantId,
        preparedReceipt.payment.id,
      );
      if (!currentPayment || !this.isReceiptEligible(currentPayment)) {
        throw new ReceiptConsistencyError(
          `Payment ${preparedReceipt.payment.id} is not eligible for receipt finalization`,
        );
      }

      const snapshot = this.getVerifiedReceiptSnapshot(currentPayment);
      if (!snapshot) {
        throw new ReceiptConsistencyError(
          `Payment ${currentPayment.id} has no trustworthy issuance snapshot`,
        );
      }
      const databaseNow = await this.getDatabaseNow(tx);
      if (
        currentPayment.receiptNumber !== preparedReceipt.receiptNumber ||
        snapshot.receiptNumber !== preparedReceipt.receiptNumber ||
        currentPayment.receiptGenerationToken !== preparedReceipt.generationToken ||
        !currentPayment.receiptGenerationLeaseUntil ||
        currentPayment.receiptGenerationLeaseUntil <= databaseNow
      ) {
        throw new ReceiptConsistencyError(
          `Receipt generation claim is no longer owned for payment ${currentPayment.id}`,
        );
      }

      const fileKey = this.buildReceiptObjectKey(
        currentPayment.tenantId,
        currentPayment.id,
        preparedReceipt.receiptNumber,
      );
      if (
        storageMetadata.bucket !== this.bucket ||
        storageMetadata.objectKey !== fileKey ||
        storageMetadata.mimeType !== RECEIPT_MIME_TYPE ||
        storageMetadata.size !== expectedSize ||
        storageMetadata.checksum !== expectedChecksum
      ) {
        throw new ReceiptConsistencyError(
          `Receipt storage metadata does not match the immutable issuance snapshot`,
        );
      }

      const existingDocument = currentPayment.receiptDocumentId
        ? await this.loadReceiptDocument(tx, tenantId, currentPayment.receiptDocumentId)
        : null;
      if (currentPayment.receiptDocumentId && !existingDocument) {
        throw new ReceiptConsistencyError(
          `Receipt document ${currentPayment.receiptDocumentId} is missing during finalization`,
        );
      }
      if (
        existingDocument &&
        !this.isReceiptDocumentIdentityValid(
          existingDocument,
          currentPayment,
          preparedReceipt.receiptNumber,
        )
      ) {
        throw new ReceiptConsistencyError(
          `Receipt document ${existingDocument.id} is inconsistent during finalization`,
        );
      }

      let documentId = existingDocument?.id;
      let fileId = existingDocument?.file.id;
      if (existingDocument?.file) {
        await this.reconcileReceiptFileMetadata(
          tx,
          currentPayment.tenantId,
          existingDocument.file.id,
          storageMetadata,
        );
      } else {
        const existingFile = await tx.file.findFirst({
          where: {
            tenantId: currentPayment.tenantId,
            bucket: this.bucket,
            objectKey: fileKey,
          },
          select: { id: true },
        });
        if (existingFile) {
          throw new ReceiptConsistencyError(
            `Receipt storage key ${this.bucket}/${fileKey} already has an unrelated database File`,
          );
        }
        const file = await tx.file.create({
          data: {
            tenantId: currentPayment.tenantId,
            bucket: this.bucket,
            objectKey: fileKey,
            originalName: `receipt_${preparedReceipt.receiptNumber}.pdf`,
            mimeType: RECEIPT_MIME_TYPE,
            size: storageMetadata.size,
            checksum: storageMetadata.checksum,
          },
        });
        fileId = file.id;

        const document = await tx.document.create({
          data: {
            tenantId: currentPayment.tenantId,
            fileId: file.id,
            title: `Recibo de pago ${preparedReceipt.receiptNumber}`,
            category: DocumentCategory.RECEIPT,
            visibility: DocumentVisibility.RESIDENTS,
            buildingId: snapshot.buildingId,
            unitId: snapshot.unitId,
          },
        });
        documentId = document.id;
      }

      if (!documentId || !fileId) {
        throw new ReceiptConsistencyError(
          `Receipt artifacts are incomplete for payment ${currentPayment.id}`,
        );
      }

      const auditExists = await this.receiptAuditExists(
        tx,
        tenantId,
        currentPayment.id,
      );
      const finalizedPayment = await tx.payment.updateMany({
        where: {
          id: currentPayment.id,
          tenantId,
          receiptGenerationToken: preparedReceipt.generationToken,
          receiptGenerationLeaseUntil: { gt: databaseNow },
        },
        data: {
          receiptDocumentId: documentId,
          receiptStatus: ReceiptStatus.READY,
          receiptGeneratedAt: databaseNow,
          receiptError: null,
          receiptGenerationToken: null,
          receiptGenerationLeaseUntil: null,
        },
      });
      if (finalizedPayment.count !== 1) {
        throw new ReceiptLeaseLostError(
          `Receipt generation claim is no longer owned for payment ${currentPayment.id}`,
        );
      }
      if (!auditExists) {
        await tx.paymentAuditLog.create({
          data: {
            tenantId: currentPayment.tenantId,
            paymentId: currentPayment.id,
            action: "RECEIPT_GENERATED",
            metadata: {
              receiptNumber: preparedReceipt.receiptNumber,
              documentId,
              objectKey: fileKey,
              snapshotVersion: snapshot.version,
              snapshotHash: this.hashReceiptSnapshot(snapshot),
            },
          },
        });
      }

      return {
        ...preparedReceipt,
        payment: currentPayment,
        snapshot,
        documentId,
        wasGenerated: !auditExists,
      };
    });
  }

  private isReceiptEligible(
    payment: Pick<PaymentReceiptPayment, "status" | "canceledAt">,
  ): boolean {
    return (
      payment.canceledAt === null &&
      (payment.status === "APPROVED" || payment.status === "RECONCILED")
    );
  }

  private async loadReceiptDocument(
    tx: Prisma.TransactionClient,
    tenantId: string,
    documentId: string,
  ): Promise<ReceiptDocumentWithFile | null> {
    return tx.document.findFirst({
      where: { id: documentId, tenantId },
      include: { file: true },
    });
  }

  private isReceiptDocumentIdentityValid(
    document: ReceiptDocumentWithFile,
    payment: Pick<PaymentReceiptPayment, "id" | "tenantId" | "buildingId" | "unitId">,
    receiptNumber: string,
  ): boolean {
    return (
      document.tenantId === payment.tenantId &&
      document.file.tenantId === payment.tenantId &&
      document.category === DocumentCategory.RECEIPT &&
      document.buildingId === payment.buildingId &&
      document.unitId === payment.unitId &&
      document.file.bucket === this.bucket &&
      document.file.objectKey ===
        this.buildReceiptObjectKey(payment.tenantId, payment.id, receiptNumber)
    );
  }

  private async receiptAuditExists(
    tx: Prisma.TransactionClient,
    tenantId: string,
    paymentId: string,
  ): Promise<boolean> {
    const audit = await tx.paymentAuditLog.findFirst({
      where: {
        tenantId,
        paymentId,
        action: "RECEIPT_GENERATED",
      },
      select: { id: true },
    });
    return audit !== null;
  }

  private buildPreparedReceipt(
    payment: PaymentReceiptPayment,
    snapshot: ReceiptSnapshot,
    receiptNumber: string,
    bucket: string,
    fileKey: string,
    documentId: string | undefined,
    existingFile: ReceiptFileArtifact | undefined,
    auditExists: boolean,
    shouldNotify: boolean,
    generationToken: string,
  ): PreparedReceiptGeneration {
    return {
      payment,
      snapshot,
      receiptNumber,
      fileKey,
      bucket,
      documentId,
      existingFile,
      auditExists,
      generationToken,
      legacyReady: false,
      shouldNotify,
    };
  }

  private getVerifiedReceiptSnapshot(
    payment: Pick<
      PaymentReceiptPayment,
      | "receiptSnapshot"
      | "receiptSnapshotVersion"
      | "receiptSnapshotHash"
      | "tenantId"
      | "id"
      | "buildingId"
      | "unitId"
      | "receiptNumber"
    >,
  ): ReceiptSnapshot | null {
    if (payment.receiptSnapshot === null || payment.receiptSnapshot === undefined) {
      return null;
    }

    const persistedHash = this.hashJsonValue(payment.receiptSnapshot);
    if (payment.receiptSnapshotHash !== persistedHash) {
      throw new ReceiptConsistencyError(
        `Receipt issuance snapshot hash is invalid for payment ${payment.id}`,
      );
    }
    const snapshot = this.parseReceiptSnapshot(payment.receiptSnapshot);
    if (
      payment.receiptSnapshotVersion !== RECEIPT_SNAPSHOT_VERSION ||
      snapshot.version !== RECEIPT_SNAPSHOT_VERSION ||
      payment.receiptSnapshotHash !== this.hashReceiptSnapshot(snapshot)
    ) {
      throw new ReceiptConsistencyError(
        `Receipt issuance snapshot is invalid for payment ${payment.id}`,
      );
    }
    if (
      snapshot.tenantId !== payment.tenantId ||
      snapshot.paymentId !== payment.id ||
      snapshot.buildingId !== payment.buildingId ||
      snapshot.unitId !== payment.unitId ||
      snapshot.receiptNumber !== payment.receiptNumber
    ) {
      throw new ReceiptConsistencyError(
        `Receipt issuance snapshot identity is inconsistent for payment ${payment.id}`,
      );
    }
    return snapshot;
  }

  private parseReceiptSnapshot(value: Prisma.JsonValue): ReceiptSnapshot {
    if (!this.isJsonRecord(value)) {
      throw new ReceiptConsistencyError("Receipt issuance snapshot is not an object");
    }

    const requiredString = (key: string): string => {
      const field = value[key];
      if (typeof field !== "string") {
        throw new ReceiptConsistencyError(`Receipt issuance snapshot field ${key} is invalid`);
      }
      return field;
    };
    const amountMinor = value.amountMinor;
    if (typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor)) {
      throw new ReceiptConsistencyError("Receipt issuance snapshot amount is invalid");
    }
    const approvedAt = value.approvedAt;
    if (approvedAt !== null && typeof approvedAt !== "string") {
      throw new ReceiptConsistencyError("Receipt issuance snapshot approval date is invalid");
    }
    const unitId = value.unitId;
    if (unitId !== null && typeof unitId !== "string") {
      throw new ReceiptConsistencyError("Receipt issuance snapshot unit identity is invalid");
    }
    const allocationValues = value.allocations;
    const allocationLines = value.allocationLines;
    if (!Array.isArray(allocationValues) || !Array.isArray(allocationLines)) {
      throw new ReceiptConsistencyError("Receipt issuance snapshot allocations are invalid");
    }
    const allocations = allocationValues.map((allocation) => {
      if (!this.isJsonRecord(allocation)) {
        throw new ReceiptConsistencyError("Receipt issuance snapshot allocation is invalid");
      }
      const allocationAmount = allocation.amountMinor;
      if (
        typeof allocationAmount !== "number" ||
        !Number.isSafeInteger(allocationAmount)
      ) {
        throw new ReceiptConsistencyError("Receipt issuance snapshot allocation amount is invalid");
      }
      return {
        period: typeof allocation.period === "string" ? allocation.period : this.invalidSnapshotField("period"),
        concept: typeof allocation.concept === "string" ? allocation.concept : this.invalidSnapshotField("concept"),
        amountMinor: allocationAmount,
        amountFormatted:
          typeof allocation.amountFormatted === "string"
            ? allocation.amountFormatted
            : this.invalidSnapshotField("amountFormatted"),
        line: typeof allocation.line === "string" ? allocation.line : this.invalidSnapshotField("line"),
      };
    });
    if (!allocationLines.every((line): line is string => typeof line === "string")) {
      throw new ReceiptConsistencyError("Receipt issuance snapshot allocation lines are invalid");
    }

    return {
      version: requiredString("version"),
      tenantId: requiredString("tenantId"),
      paymentId: requiredString("paymentId"),
      receiptNumber: requiredString("receiptNumber"),
      buildingId: requiredString("buildingId"),
      unitId,
      tenantDisplayName: requiredString("tenantDisplayName"),
      buildingName: requiredString("buildingName"),
      unitLabel: requiredString("unitLabel"),
      amountMinor,
      currency: requiredString("currency"),
      amountFormatted: requiredString("amountFormatted"),
      method: requiredString("method"),
      reference: requiredString("reference"),
      approvedAt,
      approvedAtFormatted: requiredString("approvedAtFormatted"),
      approvedByUserName: requiredString("approvedByUserName"),
      primaryPeriod: requiredString("primaryPeriod"),
      allocations,
      allocationLines,
    };
  }

  private invalidSnapshotField(field: string): never {
    throw new ReceiptConsistencyError(`Receipt issuance snapshot field ${field} is invalid`);
  }

  private isJsonRecord(value: Prisma.JsonValue | unknown): value is Record<string, Prisma.JsonValue> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private createReceiptSnapshot(
    payment: PaymentReceiptPayment,
    receiptNumber: string,
    tenantDisplayName: string,
    approvedByUserName: string,
    snapshotCreatedAt: Date,
  ): ReceiptSnapshot {
    const currency = payment.currency || "ARS";
    const allocations = payment.paymentAllocations?.length
      ? payment.paymentAllocations.map((allocation) => {
          const expensePeriod = allocation.charge?.expensePeriod;
          const period = expensePeriod
            ? `${expensePeriod.year}-${String(expensePeriod.month).padStart(2, "0")}`
            : allocation.charge?.period || "N/A";
          const concept = allocation.charge?.concept || "Cargo";
          const amountFormatted = this.formatCurrencyForReceipt(
            allocation.amount,
            currency,
          );
          return {
            period,
            concept,
            amountMinor: allocation.amount,
            amountFormatted,
            line: `${period} - ${concept} - ${amountFormatted}`,
          };
        })
      : [];
    const allocationLines = allocations.length
      ? allocations.map((allocation) => allocation.line)
      : ["Sin aplicación específica - saldo a favor"];
    const primaryPeriod = allocations[0]?.period || "N/A";
    const approvedAt = this.receiptDateIso(payment.approvedAt);

    return {
      version: RECEIPT_SNAPSHOT_VERSION,
      tenantId: payment.tenantId,
      paymentId: payment.id,
      receiptNumber,
      buildingId: payment.buildingId,
      unitId: payment.unitId,
      tenantDisplayName,
      buildingName: payment.building?.name || "Edificio",
      unitLabel: payment.unit?.label || payment.unitId || "N/A",
      amountMinor: payment.amount,
      currency,
      amountFormatted: this.formatCurrencyForReceipt(payment.amount, currency),
      method: payment.method,
      reference: payment.reference || "N/A",
      approvedAt,
      approvedAtFormatted: this.formatReceiptDate(
        payment.approvedAt ?? snapshotCreatedAt,
      ),
      approvedByUserName,
      primaryPeriod,
      allocations,
      allocationLines,
    };
  }

  private receiptDateIso(dateValue: Date | string | null | undefined): string | null {
    if (!dateValue) return null;
    return dateValue instanceof Date
      ? dateValue.toISOString()
      : new Date(dateValue).toISOString();
  }

  private toPrismaReceiptSnapshot(snapshot: ReceiptSnapshot): Prisma.InputJsonObject {
    return {
      ...snapshot,
      allocations: snapshot.allocations.map((allocation) => ({ ...allocation })),
      allocationLines: [...snapshot.allocationLines],
    };
  }

  private hashReceiptSnapshot(snapshot: ReceiptSnapshot): string {
    return this.hashJsonValue(snapshot);
  }

  private addLeaseDuration(databaseNow: Date): Date {
    return new Date(databaseNow.getTime() + RECEIPT_GENERATION_LEASE_MS);
  }

  private async getDatabaseNow(
    tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  ): Promise<Date> {
    const [row] = await tx.$queryRaw<Array<{ now: Date }>>(
      Prisma.sql`SELECT clock_timestamp() AS "now"`,
    );
    if (!(row?.now instanceof Date) || Number.isNaN(row.now.getTime())) {
      throw new Error("Database did not return a valid current timestamp");
    }
    return row.now;
  }

  private startReceiptGenerationHeartbeat(
    tenantId: string,
    paymentId: string,
    generationToken: string,
  ): ReceiptGenerationHeartbeat {
    let stopped = false;
    let lost = false;
    let renewal: Promise<void> | null = null;

    const renew = async (): Promise<void> => {
      if (stopped || lost || renewal) return;
      renewal = this.renewReceiptGenerationLease(
        tenantId,
        paymentId,
        generationToken,
      ).catch((error: unknown) => {
        lost = true;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Receipt generation lease renewal failed for payment ${paymentId}: ${message}`,
        );
      }).finally(() => {
        renewal = null;
      });
      await renewal;
    };

    const timer = setInterval(() => {
      void renew();
    }, RECEIPT_GENERATION_HEARTBEAT_INTERVAL_MS);
    timer.unref?.();

    return {
      assertOwned: () => {
        if (lost) {
          throw new ReceiptLeaseLostError(
            `Receipt generation claim is no longer owned for payment ${paymentId}`,
          );
        }
      },
      stop: async () => {
        stopped = true;
        clearInterval(timer);
        if (renewal) await renewal;
      },
    };
  }

  private async renewReceiptGenerationLease(
    tenantId: string,
    paymentId: string,
    generationToken: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await acquirePaymentReceiptLock(tx, paymentId);
      const databaseNow = await this.getDatabaseNow(tx);
      const renewed = await tx.payment.updateMany({
        where: {
          id: paymentId,
          tenantId,
          receiptGenerationToken: generationToken,
          receiptGenerationLeaseUntil: { gt: databaseNow },
        },
        data: {
          receiptGenerationLeaseUntil: this.addLeaseDuration(databaseNow),
        },
      });
      if (renewed.count !== 1) {
        throw new ReceiptLeaseLostError(
          `Receipt generation claim is no longer owned for payment ${paymentId}`,
        );
      }
    });
  }

  private async waitForReceiptGeneration(
    tenantId: string,
    paymentId: string,
    excludeUserId?: string,
  ): Promise<ReceiptData | null> {
    const deadline = Date.now() + RECEIPT_GENERATION_WAIT_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, RECEIPT_GENERATION_WAIT_INTERVAL_MS);
      });

      const payment = await this.prisma.payment.findFirst({
        where: { id: paymentId, tenantId },
        select: {
          receiptStatus: true,
          receiptGenerationToken: true,
          receiptGenerationLeaseUntil: true,
        },
      });
      if (!payment) {
        return null;
      }

      const databaseNow = await this.getDatabaseNow(this.prisma);
      const activeLease =
        payment.receiptGenerationToken !== null &&
        payment.receiptGenerationLeaseUntil !== null &&
        payment.receiptGenerationLeaseUntil > databaseNow;
      if (!activeLease) {
        if (payment.receiptStatus === ReceiptStatus.READY) {
          return this.loadCompletedReceiptData(tenantId, paymentId);
        }
        return this.ensureReceiptForPayment(tenantId, paymentId, excludeUserId);
      }
    }

    return null;
  }

  private async loadCompletedReceiptData(
    tenantId: string,
    paymentId: string,
  ): Promise<ReceiptData> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId },
      include: {
        unit: true,
        building: true,
        createdByUser: true,
        paymentAllocations: {
          include: {
            charge: {
              include: { expensePeriod: true },
            },
          },
        },
      },
    });
    if (!payment || payment.receiptStatus !== ReceiptStatus.READY) {
      throw new ReceiptConsistencyError(
        `Receipt generation completed without a READY payment ${paymentId}`,
      );
    }
    if (!payment.receiptNumber || !payment.receiptDocumentId) {
      throw new ReceiptConsistencyError(
        `Payment ${paymentId} is READY without a complete receipt artifact`,
      );
    }

    const document = await this.prisma.document.findFirst({
      where: { id: payment.receiptDocumentId, tenantId },
      include: { file: true },
    });
    if (
      !document ||
      !this.isReceiptDocumentIdentityValid(document, payment, payment.receiptNumber) ||
      !(await this.isCompleteStorageArtifact(document.file))
    ) {
      throw new ReceiptConsistencyError(
        `Receipt ${payment.receiptNumber} is not a complete canonical artifact`,
      );
    }
    if (!this.getVerifiedReceiptSnapshot(payment)) {
      throw new ReceiptConsistencyError(
        `Payment ${paymentId} is READY without a trustworthy issuance snapshot`,
      );
    }

    const url = await this.minio.presignDownload(
      document.file.bucket,
      document.file.objectKey,
      3600,
    );
    return {
      receiptNumber: payment.receiptNumber,
      documentId: document.id,
      fileKey: document.file.objectKey,
      bucket: document.file.bucket,
      url,
    };
  }

  private hashJsonValue(value: unknown): string {
    return createHash("sha256")
      .update(this.canonicalizeJson(value), "utf8")
      .digest("hex");
  }

  private canonicalizeJson(value: unknown): string {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) throw new ReceiptConsistencyError("Cannot serialize receipt snapshot");
      return serialized;
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalizeJson(item)).join(",")}]`;
    }
    if (this.isJsonRecord(value)) {
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${this.canonicalizeJson(value[key])}`)
        .join(",")}}`;
    }
    throw new ReceiptConsistencyError("Cannot serialize receipt snapshot");
  }

  private async markReceiptGenerationFailedIfNeeded(
    tenantId: string,
    paymentId: string,
    errorMessage: string,
    generationToken?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (failureTx) => {
      await acquirePaymentReceiptLock(failureTx, paymentId);
      const databaseNow = await this.getDatabaseNow(failureTx);
      const payment = await failureTx.payment.findFirst({
        where: { id: paymentId, tenantId },
        select: {
          receiptStatus: true,
          receiptGenerationToken: true,
          receiptGenerationLeaseUntil: true,
        },
      });
      if (!payment) return;
      if (
        generationToken && (
          payment.receiptGenerationToken !== generationToken ||
          !payment.receiptGenerationLeaseUntil ||
          payment.receiptGenerationLeaseUntil <= databaseNow
        )
      ) {
        return;
      }
      if (!generationToken && (
        payment.receiptStatus === ReceiptStatus.READY ||
        payment.receiptGenerationToken !== null
      )) {
        return;
      }
      await failureTx.payment.updateMany({
        where: {
          id: paymentId,
          tenantId,
          receiptStatus: { not: ReceiptStatus.READY },
          ...(generationToken
            ? {
                receiptGenerationToken: generationToken,
                receiptGenerationLeaseUntil: { gt: databaseNow },
              }
            : { receiptGenerationToken: null }),
        },
        data: {
          receiptStatus: ReceiptStatus.FAILED,
          receiptError: errorMessage,
          receiptGenerationToken: null,
          receiptGenerationLeaseUntil: null,
        },
      });
    });
  }

  private async isCompleteStorageArtifact(
    file: ReceiptFileArtifact,
  ): Promise<boolean> {
    // Legacy checksum-less artifacts are recovered, never reused as READY.
    if (file.mimeType !== RECEIPT_MIME_TYPE || !file.checksum) {
      return false;
    }
    if (!(await this.minio.objectExists(file.bucket, file.objectKey))) {
      return false;
    }
    const stat = await this.minio.statObject(file.bucket, file.objectKey);
    if (!this.isValidReceiptObjectStat(stat, file.size)) {
      return false;
    }
    const content = await this.minio.getObjectBuffer(
      file.bucket,
      file.objectKey,
    );
    return (
      this.isPdfContent(content) &&
      content.length === stat.size &&
      this.sha256(content) === file.checksum
    );
  }

  private async ensureReceiptStorageObject(
    bucket: string,
    fileKey: string,
    pdfContent: Buffer,
  ): Promise<ReceiptStorageMetadata> {
    if (!this.isPdfContent(pdfContent) || pdfContent.length > MAX_RECEIPT_OBJECT_BYTES) {
      throw new Error(`Generated receipt PDF exceeds the supported storage contract`);
    }

    // Conditional creation prevents a racing worker from replacing a
    // canonical receipt object after it has been written.
    if (!(await this.minio.objectExists(bucket, fileKey))) {
      await this.minio.uploadBufferIfAbsent(
        bucket,
        fileKey,
        pdfContent,
        RECEIPT_MIME_TYPE,
      );
    }
    const stat = await this.minio.statObject(bucket, fileKey);
    if (!this.isValidReceiptObjectStat(stat, pdfContent.length)) {
      throw new ReceiptConsistencyError(
        `Receipt storage object metadata mismatch for ${bucket}/${fileKey}`,
      );
    }
    const storedContent = await this.minio.getObjectBuffer(bucket, fileKey);
    if (
      !this.isPdfContent(storedContent) ||
      storedContent.length !== stat.size ||
      !storedContent.equals(pdfContent)
    ) {
      throw new ReceiptConsistencyError(
        `Receipt storage object content mismatch for ${bucket}/${fileKey}`,
      );
    }
    return {
      bucket,
      objectKey: fileKey,
      mimeType: RECEIPT_MIME_TYPE,
      size: storedContent.length,
      checksum: this.sha256(storedContent),
    };

  }

  private isValidReceiptObjectStat(
    stat: MinioObjectStat,
    expectedSize: number,
  ): boolean {
    const contentType = stat.metaData?.["content-type"] ?? stat.metaData?.["Content-Type"];
    return (
      stat.size > 0 &&
      stat.size <= MAX_RECEIPT_OBJECT_BYTES &&
      stat.size === expectedSize &&
      (!contentType || contentType === RECEIPT_MIME_TYPE)
    );
  }

  private isPdfContent(content: Buffer): boolean {
    return content.subarray(0, 5).toString("ascii") === "%PDF-";
  }

  private async reconcileReceiptFileMetadata(
    tx: Prisma.TransactionClient,
    tenantId: string,
    fileId: string,
    metadata: ReceiptStorageMetadata,
  ): Promise<void> {
    const result = await tx.file.updateMany({
      where: { id: fileId, tenantId },
      data: {
        bucket: metadata.bucket,
        objectKey: metadata.objectKey,
        mimeType: metadata.mimeType,
        size: metadata.size,
        checksum: metadata.checksum,
      },
    });
    if (result.count !== 1) {
      throw new ReceiptConsistencyError(
        `Receipt File ${fileId} is missing or belongs to another tenant`,
      );
    }
  }

  private sha256(content: Buffer): string {
    return createHash("sha256").update(content).digest("hex");
  }

  private async loadPaymentForReceipt(
    tx: Prisma.TransactionClient,
    tenantId: string,
    paymentId: string,
  ): Promise<PaymentReceiptPayment | null> {
    return tx.payment.findFirst({
      where: { id: paymentId, tenantId },
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
  }

  private buildReceiptObjectKey(tenantId: string, paymentId: string, receiptNumber: string): string {
    return `tenant/${tenantId}/payments/${paymentId}/receipts/${receiptNumber}.pdf`;
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

    await acquireReceiptSequenceLock(tx, tenantId, year);

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
   * Generate a receipt PDF from the immutable issuance snapshot only.
   */
  private generateReceiptPdfFromSnapshot(snapshot: ReceiptSnapshot): Buffer {
    return this.buildReceiptPdfBuffer({
      tenantDisplayName: snapshot.tenantDisplayName,
      receiptNumber: snapshot.receiptNumber,
      approvedAt: snapshot.approvedAtFormatted,
      approvedByUserName: snapshot.approvedByUserName,
      unitLabel: snapshot.unitLabel,
      buildingName: snapshot.buildingName,
      amountFormatted: snapshot.amountFormatted,
      method: snapshot.method,
      reference: snapshot.reference,
      primaryPeriod: snapshot.primaryPeriod,
      allocations: snapshot.allocationLines,
    });
  }

  /**
   * Build a snapshot-shaped PDF for legacy renderer tests and first-issuance comparison.
   * Production recovery never calls this live-data adapter.
   */
  private async generateReceiptPDF(
    payment: PaymentReceiptPayment,
    receiptNumber: string,
    approvedByUserName: string,
    tenantDisplayName: string,
  ): Promise<Buffer> {
    const snapshot = this.createReceiptSnapshot(
      payment,
      receiptNumber,
      tenantDisplayName,
      approvedByUserName,
      new Date(),
    );
    return this.generateReceiptPdfFromSnapshot(snapshot);
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
