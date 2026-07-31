import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  PayloadTooLargeException,
  Logger,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { posix as pathPosix } from 'node:path';
import type { Readable } from 'node:stream';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../storage/minio.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { DocumentsValidators } from './documents.validators';
import { ResidentAccessService } from '../resident-access/resident-access.service';
import { throwIfPaymentLinkedDocumentIsMutable } from '../common/payment-linked-document-lock';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { DocumentUploadPurpose } from './dto/presign-upload.dto';
import {
  PresignedUrlResponse,
  DocumentWithFileResponseDto,
  DownloadUrlResponseDto,
  DocumentPaymentMetadataDto,
} from './dto';
import { DocumentCategory, DocumentVisibility, Role, Prisma } from '@prisma/client';
import { publicUserSelect, toPublicUser } from '../common/public-user';

type DocumentNotificationTarget = Prisma.DocumentGetPayload<{
  include: {
    file: true;
    createdByMembership: {
      include: {
        user: {
          select: typeof publicUserSelect;
        };
      };
    };
  };
}>;

type DocumentWithPublicMembershipUser = {
  createdByMembership?: {
    user?: {
      id: string;
      email: string;
      name: string;
    } | null;
  } | null;
};

type UnitOccupantNotificationRecipient = Prisma.UnitOccupantGetPayload<{
  include: {
    member: {
      select: {
        user: {
          select: {
            id: true;
          };
        };
      };
    };
  };
}>;

type DocumentContentResponse = {
  stream: Readable;
  contentType: string;
  contentLength: number;
  fileName: string;
  disposition: 'inline' | 'attachment';
};

const ALLOWED_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
];

const GENERAL_DOCUMENT_MAX_BYTES = 100 * 1024 * 1024;
const PAYMENT_PROOF_MAX_BYTES = 10 * 1024 * 1024;

/**
 * DocumentsService: CRUD operations for Documents and Files with MinIO integration
 *
 * Flow:
 * 1. Client requests presigned URL (POST /documents/presign)
 *    → Service generates objectKey, calls MinIO for presigned URL
 *    → Returns presignedUrl to client
 *
 * 2. Client uploads file to MinIO using presigned URL (PUT to MinIO, not to our API)
 *
 * 3. Client creates Document record (POST /documents)
 *    → Validates objectKey matches uploaded file, validates scope
 *    → Creates File + Document records atomically
 *    → Validates permissions
 *
 * 4. Client can list (GET /documents) or get detail (GET /documents/:id)
 *    → Service filters by visibility rules
 *    → RESIDENT role has additional unit/building scope validation
 *
 * 5. Client downloads via presigned URL (GET /documents/:id/download)
 *    → Service validates access, generates presigned GET URL from MinIO
 *
 * 6. Client can delete (DELETE /documents/:id)
 *    → Validates creator/admin only
 *    → Deletes Document (cascade → File)
 *    → Separate async job handles MinIO cleanup
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly validators: DocumentsValidators,
    private readonly minio: MinioService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly residentAccess: ResidentAccessService,
  ) {}

  /**
   * Generate presigned URL for file upload to MinIO
   *
   * @param tenantId - Tenant context
   * @param originalName - Original filename
   * @param mimeType - MIME type (validation: must match safety rules)
   * @returns Presigned URL response with objectKey and expiration
   */
  async presignUpload(
    tenantId: string,
    originalName: string,
    mimeType: string,
    size?: number,
    purpose: DocumentUploadPurpose = DocumentUploadPurpose.GENERAL_DOCUMENT,
  ): Promise<PresignedUrlResponse> {
    // Validate file type (prevent malicious uploads)
    this.validateMimeType(mimeType);
    if (size != null) {
      this.validateUploadSize(size, purpose);
    }

    // Generate objectKey with tenant isolation
    const objectKey = this.generateObjectKey(tenantId, originalName, purpose);
    const bucket = this.minio.getDefaultBucket();

    // Generate presigned URL from MinIO (24 hours expiration)
    const expirySeconds = 24 * 60 * 60;
    const url = await this.minio.presignUpload(bucket, objectKey, expirySeconds);

    return {
      url,
      bucket,
      objectKey,
      expiresAt: new Date(Date.now() + expirySeconds * 1000),
    };
  }

  /**
   * Create a Document after file upload
   *
   * Validates:
   * - Scope constraint (buildingId/unitId/neither)
   * - Building belongs to tenant
   * - Unit belongs to building
   * - ObjectKey is valid (file was uploaded)
   * - User has documents.upload permission
   *
   * @throws BadRequestException if scope is invalid
   * @throws NotFoundException if building/unit not found
   */
  async createDocument(
    tenantId: string,
    userMembershipId: string,
    dto: CreateDocumentDto,
  ): Promise<DocumentWithFileResponseDto> {
    const uploadFile = dto.file;

    // Validate scope constraint
    this.validators.validateDocumentScope(dto.buildingId, dto.unitId);

    // Validate building belongs to tenant (if scoped)
    if (dto.buildingId) {
      await this.validators.validateBuildingBelongsToTenant(
        tenantId,
        dto.buildingId,
      );
    }

    // Validate unit belongs to building (if scoped)
    if (dto.unitId && dto.buildingId) {
      await this.validators.validateUnitBelongsToBuilding(
        tenantId,
        dto.buildingId,
        dto.unitId,
      );
    }

    const uploadPurpose = this.validateUploadedObjectKeyOwnership(
      tenantId,
      uploadFile.objectKey,
    );

    const existingFile = await this.prisma.file.findFirst({
      where: {
        tenantId,
        objectKey: uploadFile.objectKey,
      },
      select: { id: true },
    });
    if (existingFile) {
      throw new ConflictException(
        'El archivo ya fue vinculado a un documento y no puede reutilizarse',
      );
    }

    // Validate file metadata before touching storage records
    try {
      this.validateMimeType(uploadFile.mimeType);
    } catch (error) {
      await this.deleteUploadedObject(uploadFile.objectKey);
      throw error;
    }

    // Validate objectKey exists in MinIO before creating document record
    const bucket = this.minio.getDefaultBucket();

    const fileExists = await this.minio.objectExists(bucket, uploadFile.objectKey);
    if (!fileExists) {
      throw new BadRequestException(
        'File not found in storage. Upload the file first and try again.',
      );
    }

    const uploadedObject = await this.minio.statObject(bucket, uploadFile.objectKey);
    if (uploadedObject.size <= 0) {
      await this.deleteUploadedObject(uploadFile.objectKey);
      throw new BadRequestException('El archivo no puede estar vacío');
    }

    if (uploadedObject.size > this.maxUploadBytesFor(uploadPurpose)) {
      await this.deleteUploadedObject(uploadFile.objectKey);
      throw new PayloadTooLargeException(
        `El archivo supera el máximo de ${this.maxUploadMegabytesFor(uploadPurpose)} MB`,
      );
    }

    let document: DocumentNotificationTarget | null = null;

    try {
      document = await this.prisma.$transaction(async (tx) => {
        const file = await tx.file.create({
          data: {
            tenantId,
            bucket,
            objectKey: uploadFile.objectKey,
            originalName: this.sanitizeFileName(uploadFile.originalName),
            mimeType: uploadFile.mimeType,
            size: uploadedObject.size,
            checksum: uploadFile.checksum,
            createdByMembershipId: userMembershipId,
          },
        });

        return await tx.document.create({
          data: {
            tenantId,
            fileId: file.id,
            title: dto.title,
            category: dto.category,
            visibility: dto.visibility ?? 'TENANT_ADMINS',
            buildingId: dto.buildingId,
            unitId: dto.unitId,
            createdByMembershipId: userMembershipId,
          },
          include: {
            file: true,
            createdByMembership: {
              include: {
                user: {
                  select: publicUserSelect,
                },
              },
            },
          },
        });
      });
    } catch (error) {
      if (!(await this.shouldPreserveUploadedObject(tenantId, bucket, uploadFile.objectKey, error))) {
        await this.deleteUploadedObject(uploadFile.objectKey);
      }
      throw error;
    }

    if (!document) {
      await this.deleteUploadedObject(uploadFile.objectKey);
      throw new BadRequestException('Failed to persist document metadata');
    }

    // [PHASE 2 QUICK #6] Send transactional notification after document creation
    void this.sendDocumentSharedNotification(tenantId, document, uploadPurpose);

    // [PHASE 2 QUICK #7] Audit: DOCUMENT_CREATE
    void this.auditService.createLog({
      tenantId,
      actorMembershipId: userMembershipId,
      action: AuditAction.DOCUMENT_CREATE,
      entityType: 'Document',
      entityId: document.id,
      metadata: {
        title: document.title,
        category: document.category,
        visibility: document.visibility,
        buildingId: document.buildingId || undefined,
        unitId: document.unitId || undefined,
      },
    });

    return this.sanitizeDocumentResponse(document);
  }

  /**
   * List Documents with permission-based filtering
   *
   * Visibility Rules:
   * - TENANT_ADMINS: Only admin roles see
   * - RESIDENTS: All roles see
   * - PRIVATE: Only creator + SUPER_ADMIN
   *
   * RESIDENT Role Scope:
   * - Tenant-wide docs: Only if visibility=RESIDENTS
   * - Building-scoped: Only if user is occupant of building
   * - Unit-scoped: Only if user is occupant of unit
   * - Creator: Can always see their own documents
   *
   * @param tenantId - Tenant context
   * @param userId - User requesting list
   * @param userRoles - User's roles in tenant
   * @param isSuperAdmin - Is user SUPER_ADMIN
   * @param filters - Optional filters (buildingId, unitId, category, visibility)
   */
  async listDocuments(
    tenantId: string,
    userId: string,
    userRoles: string[],
    isSuperAdmin: boolean,
    filters?: {
      buildingId?: string;
      unitId?: string;
      category?: DocumentCategory;
      visibility?: DocumentVisibility;
    },
  ): Promise<DocumentWithFileResponseDto[]> {
    const isAdmin =
      userRoles.includes(Role.TENANT_ADMIN) ||
      userRoles.includes(Role.TENANT_OWNER) ||
      userRoles.includes(Role.OPERATOR);

    const enforceResidentScope = this.residentAccess.shouldEnforce(
      isSuperAdmin ? [...userRoles, Role.SUPER_ADMIN] : userRoles,
    );

    // Base query: always filter by tenant
    const whereConditions: Prisma.DocumentWhereInput = { tenantId };

    // Add scope filters
    if (filters?.buildingId) {
      whereConditions.buildingId = filters.buildingId;
    }
    if (filters?.unitId) {
      whereConditions.unitId = filters.unitId;
    }
    if (filters?.category) {
      whereConditions.category = filters.category;
    }

    // Visibility filtering for non-admin, non-creator users
    if (!isAdmin && !isSuperAdmin) {
      // Admin sees all
      // Non-admin sees: visibility=RESIDENTS, or visibility=PRIVATE if creator
      // For now, simple query; complexity of OR logic handled in post-processing

      whereConditions.OR = [
        { visibility: DocumentVisibility.RESIDENTS },
        {
          AND: [
            { visibility: DocumentVisibility.PRIVATE },
            { createdByMembership: { userId } },
          ],
        },
      ];
    } else if (!isAdmin && isSuperAdmin) {
      // SUPER_ADMIN sees all (no filter)
    }

    // Execute query
    let documents = await this.prisma.document.findMany({
      where: whereConditions,
      include: {
        file: true,
        createdByMembership: {
          include: {
            user: {
              select: publicUserSelect,
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Post-process: RESIDENT role scope validation
    if (enforceResidentScope) {
      const filteredDocs = await Promise.all(
        documents.map(async (doc) => {
          try {
            await this.validators.validateResidentDocumentAccess(
              tenantId,
              userId,
              doc.buildingId,
              doc.unitId,
              doc.visibility,
              doc.createdByMembership?.userId === userId,
            );
            return doc;
          } catch {
            return null; // Filter out inaccessible documents
          }
        }),
      );

      documents = filteredDocs.filter((doc): doc is typeof documents[0] => doc !== null);
    }

    // Enrich documents with payment metadata (batch, no N+1)
    const enriched = await this.enrichDocumentsWithPaymentMetadata(tenantId, documents);

    return enriched.map((document) =>
      this.sanitizeDocumentResponse(document as DocumentWithPublicMembershipUser & Record<string, unknown>),
    );
  }

  /**
   * Get a single Document
   *
   * Validates access control before returning
   */
  async getDocument(
    tenantId: string,
    documentId: string,
    userId: string,
    userRoles: string[],
    isSuperAdmin: boolean,
  ): Promise<DocumentWithFileResponseDto> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, tenantId },
      include: {
        file: true,
        createdByMembership: {
          include: {
            user: {
              select: publicUserSelect,
            },
          },
        },
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // Check visibility
    const isDocumentCreator = document.createdByMembership?.userId === userId;
    const isAdmin =
      userRoles.includes(Role.TENANT_ADMIN) ||
      userRoles.includes(Role.TENANT_OWNER) ||
      userRoles.includes(Role.OPERATOR);

    const canAccess = this.validators.canAccessDocument(
      document.visibility,
      userRoles,
      isDocumentCreator,
      isSuperAdmin,
    );

    if (!canAccess) {
      throw new NotFoundException('Document not found');
    }

    // Check RESIDENT scope
    if (!isAdmin && !isSuperAdmin && userRoles.includes(Role.RESIDENT)) {
      await this.validators.validateResidentDocumentAccess(
        tenantId,
        userId,
        document.buildingId,
        document.unitId,
        document.visibility,
        isDocumentCreator,
      );
    }

    return this.sanitizeDocumentResponse(document);
  }

  /**
   * Update Document metadata
   *
   * Only creator or admin can update
   */
  async updateDocument(
    tenantId: string,
    documentId: string,
    userId: string,
    userRoles: string[],
    dto: UpdateDocumentDto,
  ): Promise<DocumentWithFileResponseDto> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, tenantId },
      include: {
        createdByMembership: true,
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // Check permission: only creator or admin can update
    const isDocumentCreator = document.createdByMembership?.userId === userId;
    const isAdmin =
      userRoles.includes(Role.TENANT_ADMIN) ||
      userRoles.includes(Role.TENANT_OWNER) ||
      userRoles.includes(Role.OPERATOR);

    if (!isDocumentCreator && !isAdmin) {
      throw new NotFoundException('Document not found');
    }

    if (this.residentAccess.shouldEnforce(userRoles)) {
      await this.validators.validateResidentDocumentAccess(
        tenantId,
        userId,
        document.buildingId,
        document.unitId,
        document.visibility,
        isDocumentCreator,
      );
    }

    // Update
    const updated = await this.prisma.$transaction(async (tx) => {
      await throwIfPaymentLinkedDocumentIsMutable(tx, tenantId, documentId, document.fileId);

      const lockedDocument = await tx.document.findFirst({
        where: { id: documentId, tenantId },
        include: {
          file: true,
          createdByMembership: {
            include: {
              user: {
                select: publicUserSelect,
              },
            },
          },
        },
      });

      if (!lockedDocument) {
        throw new NotFoundException('Document not found');
      }

      const updatedDocument = await tx.document.update({
        where: { id: documentId },
        data: {
          ...(dto.title && { title: dto.title }),
          ...(dto.category && { category: dto.category }),
          ...(dto.visibility && { visibility: dto.visibility }),
        },
        include: {
          file: true,
          createdByMembership: {
            include: {
              user: {
                select: publicUserSelect,
              },
            },
          },
        },
      });

      return updatedDocument;
    });

    return this.sanitizeDocumentResponse(updated);
  }

  /**
   * Delete Document
   *
   * Only creator or admin can delete
   * Document deletion cascades to File deletion
   * MinIO cleanup should be done asynchronously (separate job)
   */
  async deleteDocument(
    tenantId: string,
    documentId: string,
    userId: string,
    userRoles: string[],
  ): Promise<void> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, tenantId },
      include: {
        file: true,
        createdByMembership: true,
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // Check permission: only creator or admin can delete
    const isDocumentCreator = document.createdByMembership?.userId === userId;
    const isAdmin =
      userRoles.includes(Role.TENANT_ADMIN) ||
      userRoles.includes(Role.TENANT_OWNER) ||
      userRoles.includes(Role.OPERATOR);

    if (!isDocumentCreator && !isAdmin) {
      throw new NotFoundException('Document not found');
    }

    if (this.residentAccess.shouldEnforce(userRoles)) {
      await this.validators.validateResidentDocumentAccess(
        tenantId,
        userId,
        document.buildingId,
        document.unitId,
        document.visibility,
        isDocumentCreator,
      );
    }

    // Get file info before delete (for MinIO cleanup)
    const fileInfo = document.file;

    await this.prisma.$transaction(async (tx) => {
      await throwIfPaymentLinkedDocumentIsMutable(tx, tenantId, documentId, document.fileId);

      const lockedDocument = await tx.document.findFirst({
        where: { id: documentId, tenantId },
        include: {
          file: true,
          createdByMembership: true,
        },
      });

      if (!lockedDocument) {
        throw new NotFoundException('Document not found');
      }

      // Delete Document (cascades to File)
      await tx.document.delete({
        where: { id: documentId },
      });
    });

    // [PHASE 2 QUICK #7] Audit: DOCUMENT_DELETE
    void this.auditService.createLog({
      tenantId,
      actorUserId: userId,
      action: AuditAction.DOCUMENT_DELETE,
      entityType: 'Document',
      entityId: documentId,
      metadata: {
        title: document.title,
        category: document.category,
      },
    });

    // Delete file from MinIO asynchronously (fire-and-forget)
    // Don't await or throw if it fails - document is already deleted
    void Promise.resolve(
      this.minio.deleteObject(fileInfo.bucket, fileInfo.objectKey),
    ).catch((error) => {
      this.logger.error(
        `Failed to delete file from MinIO: ${fileInfo.bucket}/${fileInfo.objectKey}`,
        error,
      );
    });
  }

  /**
   * Get presigned download URL
   *
   * Validates access control before returning URL
   *
   * @returns Presigned GET URL for client to download file
   */
  async getDownloadUrl(
    tenantId: string,
    documentId: string,
    userId: string,
    userRoles: string[],
    isSuperAdmin: boolean,
  ): Promise<DownloadUrlResponseDto> {
    // First, validate document is accessible
    const document = await this.getDocument(
      tenantId,
      documentId,
      userId,
      userRoles,
      isSuperAdmin,
    );

    if (!document.file) {
      throw new NotFoundException('Document file not found');
    }

    // Generate presigned URL from MinIO (24 hours expiration)
    const expirySeconds = 24 * 60 * 60;
    const url = await this.minio.presignDownload(
      document.file.bucket,
      document.file.objectKey,
      expirySeconds,
    );

    return {
      url,
      expiresAt: new Date(Date.now() + expirySeconds * 1000),
    };
  }

  /**
   * Get a protected document stream for authenticated downloads.
   *
   * Keeps the browser inside BuildingOS and never exposes MinIO URLs.
   */
  async getDocumentContent(
    tenantId: string,
    documentId: string,
    userId: string,
    userRoles: string[],
    isSuperAdmin: boolean,
  ): Promise<DocumentContentResponse> {
    const document = await this.getDocument(
      tenantId,
      documentId,
      userId,
      userRoles,
      isSuperAdmin,
    );

    if (!document.file) {
      throw new NotFoundException('Document file not found');
    }

    const bucket = document.file.bucket;
    const objectKey = document.file.objectKey;
    const exists = await this.minio.objectExists(bucket, objectKey);
    if (!exists) {
      throw new NotFoundException('Document file not found');
    }

    const uploadedObject = await this.minio.statObject(bucket, objectKey);
    if (uploadedObject.size <= 0) {
      throw new NotFoundException('Document file not found');
    }

    const stream = await this.minio.getObjectStream(bucket, objectKey);
    const contentType = document.file.mimeType || 'application/octet-stream';

    return {
      stream,
      contentType,
      contentLength: uploadedObject.size,
      fileName: this.sanitizeDownloadFileName(document.file.originalName),
      disposition: this.shouldRenderInline(contentType) ? 'inline' : 'attachment',
    };
  }

  /**
   * Validate MIME type (prevent unsafe uploads)
   * Allowed: PDF, images, Office docs, spreadsheets, etc.
   * Blocked: executables, scripts, etc.
   */
  private validateMimeType(mimeType: string): void {
    if (!ALLOWED_UPLOAD_MIME_TYPES.includes(mimeType)) {
      throw new BadRequestException(
        `File type not allowed: ${mimeType}`,
      );
    }
  }

  private validateUploadSize(size: number, purpose: DocumentUploadPurpose): void {
    if (size <= 0) {
      throw new BadRequestException('El archivo no puede estar vacío');
    }

    if (size > this.maxUploadBytesFor(purpose)) {
      throw new PayloadTooLargeException(
        `El archivo supera el máximo de ${this.maxUploadMegabytesFor(purpose)} MB`,
      );
    }
  }

  private validateUploadedObjectKeyOwnership(
    tenantId: string,
    objectKey: string,
  ): DocumentUploadPurpose {
    if (!objectKey || objectKey.trim().length === 0) {
      throw new BadRequestException('The uploaded file key is invalid');
    }

    if (objectKey.includes('\\') || objectKey.includes('\0')) {
      throw new BadRequestException('The uploaded file key is invalid');
    }

    const normalized = pathPosix.normalize(objectKey);
    if (
      normalized !== objectKey ||
      normalized.startsWith('..') ||
      pathPosix.isAbsolute(objectKey)
    ) {
      throw new BadRequestException('The uploaded file key is invalid');
    }

    const prefixes: ReadonlyArray<readonly [string, DocumentUploadPurpose]> = [
      [`tenant-${tenantId}/documents/`, DocumentUploadPurpose.GENERAL_DOCUMENT],
      [`tenant-${tenantId}/payment-proofs/`, DocumentUploadPurpose.PAYMENT_PROOF],
    ];
    const prefixMatch = prefixes.find(([prefix]) => objectKey.startsWith(prefix));
    if (!prefixMatch) {
      throw new ForbiddenException('The uploaded file key does not belong to this tenant');
    }

    const relativePath = objectKey.slice(prefixMatch[0].length);
    if (!relativePath) {
      throw new BadRequestException('The uploaded file key is invalid');
    }

    const segments = objectKey.split('/');
    if (
      segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
    ) {
      throw new BadRequestException('The uploaded file key is invalid');
    }

    return prefixMatch[1];
  }

  private maxUploadBytesFor(purpose: DocumentUploadPurpose): number {
    return purpose === DocumentUploadPurpose.PAYMENT_PROOF
      ? PAYMENT_PROOF_MAX_BYTES
      : GENERAL_DOCUMENT_MAX_BYTES;
  }

  private maxUploadMegabytesFor(purpose: DocumentUploadPurpose): number {
    return this.maxUploadBytesFor(purpose) / 1024 / 1024;
  }

  private async deleteUploadedObject(objectKey: string): Promise<void> {
    try {
      await this.minio.deleteObject(this.minio.getDefaultBucket(), objectKey);
    } catch (error) {
      this.logger.warn(`Unable to clean up rejected upload ${objectKey}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async shouldPreserveUploadedObject(
    tenantId: string,
    bucket: string,
    objectKey: string,
    error: unknown,
  ): Promise<boolean> {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }

    const objectKeyTenantId = this.extractTenantIdFromObjectKey(objectKey);
    if (!objectKeyTenantId || objectKeyTenantId !== tenantId) {
      return false;
    }

    try {
      const existingFile = await this.prisma.file.findFirst({
        where: {
          tenantId,
          bucket,
          objectKey,
        },
        select: { id: true },
      });

      return !!existingFile;
    } catch (lookupError) {
      this.logger.warn(
        `Unable to verify concurrent file ownership for ${objectKey}: ${lookupError instanceof Error ? lookupError.message : String(lookupError)}`,
      );
      return false;
    }
  }

  private extractTenantIdFromObjectKey(objectKey: string): string {
    const match = /^tenant-([^/]+)\/(?:documents|payment-proofs)\/(.+)$/.exec(objectKey);
    if (!match) {
      return '';
    }

    const [, tenantId, relativePath] = match;
    if (!tenantId || !relativePath) {
      return '';
    }

    const normalized = pathPosix.normalize(objectKey);
    if (
      normalized !== objectKey ||
      relativePath.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
    ) {
      return '';
    }

    return tenantId;
  }

  /**
   * Generate object key with tenant isolation
   * Format: tenant-{tenantId}/documents/{uuid}-{originalName}
   */
  private generateObjectKey(
    tenantId: string,
    originalName: string,
    purpose: DocumentUploadPurpose,
  ): string {
    const uuid = this.generateUuid();
    const sanitized = this.sanitizeFileName(originalName);
    const directory = purpose === DocumentUploadPurpose.PAYMENT_PROOF
      ? 'payment-proofs'
      : 'documents';
    return `tenant-${tenantId}/${directory}/${uuid}-${sanitized}`;
  }

  private sanitizeFileName(originalName: string): string {
    return originalName.replace(/[^a-z0-9._-]/gi, '_');
  }

  private sanitizeDownloadFileName(originalName: string): string {
    return this.sanitizeFileName(originalName)
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '') || 'document';
  }

  private shouldRenderInline(mimeType: string): boolean {
    return mimeType.startsWith('application/pdf') || mimeType.startsWith('image/');
  }

  /**
   * Simple UUID v4 generator (in production use uuid package)
   */
  private generateUuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Check if a resident has access to a specific unit
   * Used to validate payment proof uploads
   */
  async checkResidentUnitAccess(
    tenantId: string,
    userId: string,
    unitId: string,
  ): Promise<boolean> {
    try {
      await this.residentAccess.assertUnitAccess(tenantId, userId, unitId);
      return true;
    } catch (error: unknown) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  /**
   * Enrich documents with payment metadata using batch queries (no N+1).
   *
   * For each document, resolves:
   * - functionalType: PAYMENT_PROOF | PAYMENT_RECEIPT | null
   * - origin: UPLOADED | GENERATED | null
   * - payment: { id, amount, currency, status, reference, receiptNumber, period } | null
   *
   * Classification rules (mutually exclusive, receipt takes precedence):
   * 1. Payment.receiptDocumentId === Document.id → PAYMENT_RECEIPT
   * 2. Payment.proofFileId === Document.fileId → PAYMENT_PROOF
   * 3. No match → null (not a financial document)
   */
  private async enrichDocumentsWithPaymentMetadata(
    tenantId: string,
    documents: Array<{
      id: string;
      fileId: string;
      [key: string]: unknown;
    }>,
  ): Promise<Array<Record<string, unknown>>> {
    if (documents.length === 0) return documents;

    const documentIds = documents.map((d) => d.id);
    const fileIds = documents.map((d) => d.fileId);

    // Single batch query: find all payments in this tenant that match
    // either receiptDocumentId or proofFileId from the authorized documents
    const relatedPayments = await this.prisma.payment.findMany({
      where: {
        tenantId,
        canceledAt: null,
        OR: [
          { receiptDocumentId: { in: documentIds } },
          { proofFileId: { in: fileIds } },
        ],
      },
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        reference: true,
        receiptNumber: true,
        receiptDocumentId: true,
        proofFileId: true,
        paymentAllocations: {
          select: {
            charge: {
              select: {
                period: true,
                expensePeriod: {
                  select: { year: true, month: true },
                },
              },
            },
          },
          // take: 2 distinguishes 0, 1, or 2+ allocations in a single query.
          // With 2+ allocations, period is set to null (ambiguous multi-period).
          take: 2,
        },
      },
    });

    // Build lookup maps
    const receiptMap = new Map<string, (typeof relatedPayments)[number]>();
    const proofMap = new Map<string, (typeof relatedPayments)[number]>();

    for (const payment of relatedPayments) {
      if (payment.receiptDocumentId) {
        receiptMap.set(payment.receiptDocumentId, payment);
      }
      if (payment.proofFileId) {
        proofMap.set(payment.proofFileId, payment);
      }
    }

    // Enrich documents
    return documents.map((doc) => {
      // Prefer receipt (direct Document relationship) over proof (File relationship)
      const receiptPayment = receiptMap.get(doc.id);
      if (receiptPayment) {
        return {
          ...doc,
          functionalType: 'PAYMENT_RECEIPT' as const,
          origin: 'GENERATED' as const,
          payment: this.buildPaymentMetadata(receiptPayment),
        };
      }

      const proofPayment = proofMap.get(doc.fileId);
      if (proofPayment) {
        return {
          ...doc,
          functionalType: 'PAYMENT_PROOF' as const,
          origin: 'UPLOADED' as const,
          payment: this.buildPaymentMetadata(proofPayment),
        };
      }

      // Not linked to any payment
      return {
        ...doc,
        functionalType: null,
        origin: null,
        payment: null,
      };
    });
  }

  /**
   * Build payment metadata DTO from a payment record.
   * Period is resolved only when there is a single allocation with an
   * unambiguous expensePeriod. Multiple allocations or missing period
   * result in null.
   */
  private buildPaymentMetadata(
    payment: {
      id: string;
      amount: number;
      currency: string;
      status: string;
      reference?: string | null;
      receiptNumber?: string | null;
      paymentAllocations: Array<{
        charge: {
          period: string | null;
          expensePeriod: { year: number; month: number } | null;
        };
      }>;
    },
  ): DocumentPaymentMetadataDto {
    let period: string | null = null;

    if (payment.paymentAllocations.length === 1) {
      const allocation = payment.paymentAllocations[0];
      if (allocation?.charge.expensePeriod) {
        const { year, month } = allocation.charge.expensePeriod;
        period = `${year}-${String(month).padStart(2, '0')}`;
      } else if (allocation?.charge.period) {
        period = allocation.charge.period;
      }
    }

    return {
      id: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      reference: payment.reference ?? null,
      receiptNumber: payment.receiptNumber ?? null,
      period,
    };
  }

  /**
   * [PHASE 2 QUICK #6] Send DOCUMENT_SHARED notification when document visibility=RESIDENTS
   * Fire-and-forget: logs errors but never throws
   */
  private async sendDocumentSharedNotification(
    tenantId: string,
    document: DocumentNotificationTarget,
    uploadPurpose: DocumentUploadPurpose,
  ): Promise<void> {
    try {
      const actorUserId = document.createdByMembership?.user?.id ?? null;

      if (uploadPurpose === DocumentUploadPurpose.PAYMENT_PROOF) return;

      // Only notify for RESIDENTS visibility on general documents
      if (document.visibility !== 'RESIDENTS') return;

      const recipientUnitOccupants: UnitOccupantNotificationRecipient[] = document.unitId
        ? await this.prisma.unitOccupant.findMany({
            where: {
              tenantId,
              unitId: document.unitId,
              endDate: null, // Active only
            },
            include: {
              member: { select: { user: { select: { id: true } } } },
            },
          })
        : document.buildingId
          ? await this.prisma.unitOccupant.findMany({
              where: {
                tenantId,
                unit: { buildingId: document.buildingId },
                endDate: null, // Active only
              },
              include: {
                member: { select: { user: { select: { id: true } } } },
              },
            })
          : await this.prisma.unitOccupant.findMany({
              where: {
                tenantId,
                endDate: null, // Active only
              },
              include: {
                member: { select: { user: { select: { id: true } } } },
              },
            });

      const recipientIds = new Set(
        recipientUnitOccupants
          .map((occupant) => occupant.member?.user?.id)
          .filter((userId): userId is string => !!userId && userId !== actorUserId),
      );

      for (const userId of recipientIds) {
        await this.notificationsService.createNotification({
          tenantId,
          userId,
          type: 'DOCUMENT_SHARED',
          title: 'Documento compartido contigo',
          body: `Se ha compartido el documento "${document.title}" (${document.category}). Puedes descargarlo desde la sección Documentos.`,
          data: {
            documentId: document.id,
            documentTitle: document.title,
            documentCategory: document.category,
          },
          deliveryMethods: ['IN_APP', 'EMAIL'],
        });
      }
    } catch (error) {
      // Fire-and-forget: log but never fail
      this.logger.error(
        `Failed to send document shared notification for document ${document.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private sanitizeDocumentResponse(
    document: DocumentWithPublicMembershipUser & Record<string, unknown>,
  ): DocumentWithFileResponseDto {
    if (!document.createdByMembership) {
      return document as unknown as DocumentWithFileResponseDto;
    }

    return {
      ...document,
      createdByMembership: {
        ...document.createdByMembership,
        user: toPublicUser(document.createdByMembership.user) ?? undefined,
      },
    } as unknown as DocumentWithFileResponseDto;
  }

}
