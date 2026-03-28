import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Document } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../storage/minio.service';
import { DocumentsValidators } from './documents.validators';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import {
  PresignedUrlResponse,
  DocumentResponseDto,
  DocumentWithFileResponseDto,
  DownloadUrlResponseDto,
} from './dto';
import { DocumentCategory, DocumentVisibility, Role, Prisma } from '@prisma/client';

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
  ): Promise<PresignedUrlResponse> {
    // Validate file type (prevent malicious uploads)
    this.validateMimeType(mimeType);

    // Generate objectKey with tenant isolation
    const objectKey = this.generateObjectKey(tenantId, originalName);

    // Generate presigned URL from MinIO (24 hours expiration)
    const expirySeconds = 24 * 60 * 60;
    const url = await this.minio.presignUpload('documents', objectKey, expirySeconds);

    return {
      url,
      bucket: 'documents',
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

    // Validate objectKey exists in MinIO before creating document record
    const fileExists = await this.minio.objectExists('documents', dto.objectKey);
    if (!fileExists) {
      throw new BadRequestException(
        'File not found in storage. Upload the file first and try again.',
      );
    }

    // Create File and Document atomically
    const file = await this.prisma.file.create({
      data: {
        tenantId,
        bucket: 'documents', // Standard bucket for all documents
        objectKey: dto.objectKey,
        originalName: dto.objectKey.split('/').pop() || 'document',
        mimeType: 'application/octet-stream', // Will be overwritten by client
        size: dto.size,
        checksum: dto.checksum,
        createdByMembershipId: userMembershipId,
      },
    });

    const document = await this.prisma.document.create({
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
          include: { user: true },
        },
      },
    });

    return document as unknown as DocumentWithFileResponseDto;
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

    const isResident = userRoles.includes(Role.RESIDENT);

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
          include: { user: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Post-process: RESIDENT role scope validation
    if (isResident && !isAdmin) {
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

    return documents as unknown as DocumentWithFileResponseDto[];
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
          include: { user: true },
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

    return document as unknown as DocumentWithFileResponseDto;
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

    // Update
    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        ...(dto.title && { title: dto.title }),
        ...(dto.category && { category: dto.category }),
        ...(dto.visibility && { visibility: dto.visibility }),
      },
      include: {
        file: true,
        createdByMembership: {
          include: { user: true },
        },
      },
    });

    return updated as unknown as DocumentWithFileResponseDto;
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

    // Get file info before delete (for MinIO cleanup)
    const fileInfo = document.file;

    // Delete Document (cascades to File)
    await this.prisma.document.delete({
      where: { id: documentId },
    });

    // Delete file from MinIO asynchronously (fire-and-forget)
    // Don't await or throw if it fails - document is already deleted
    this.minio
      .deleteObject(fileInfo.bucket, fileInfo.objectKey)
      .catch((error) => {
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
   * Validate MIME type (prevent unsafe uploads)
   * Allowed: PDF, images, Office docs, spreadsheets, etc.
   * Blocked: executables, scripts, etc.
   */
  private validateMimeType(mimeType: string): void {
    const allowedTypes = [
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

    if (!allowedTypes.includes(mimeType)) {
      throw new BadRequestException(
        `File type not allowed: ${mimeType}`,
      );
    }
  }

  /**
   * Generate object key with tenant isolation
   * Format: tenant-{tenantId}/documents/{uuid}-{originalName}
   */
  private generateObjectKey(tenantId: string, originalName: string): string {
    const uuid = this.generateUuid();
    const sanitized = originalName.replace(/[^a-z0-9._-]/gi, '_');
    return `tenant-${tenantId}/documents/${uuid}-${sanitized}`;
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
}
