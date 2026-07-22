import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Delete,
  Param,
  UseGuards,
  Request,
  Query,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { DocumentCategory, DocumentVisibility } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { DocumentsService } from './documents.service';
import { ResidentAccessService } from '../resident-access/resident-access.service';
import { PresignUploadDto, PresignedUrlResponse } from './dto/presign-upload.dto';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import type { TenantContextRequest } from '../common/types/request.types';

/**
 * DocumentsController: Documents and Files management
 *
 * Routes: /documents
 *
 * Security:
 * 1. JwtAuthGuard: Requires valid JWT token
 *    - req.user = { id, email, roles }
 *    - Tenant context inferred from user's active membership
 *
 * 2. Service layer validates:
 *    - Document scope (buildingId/unitId/neither)
 *    - Visibility rules (TENANT_ADMINS, RESIDENTS, PRIVATE)
 *    - RESIDENT role unit/building access
 *
 * Flow:
 * 1. POST /documents/presign - Get presigned upload URL
 *    - No authorization needed (any authenticated user)
 *    - Returns objectKey to use in step 2
 *
 * 2. Client uploads file to MinIO using presigned URL (external)
 *
 * 3. POST /documents - Create Document record
 *    - Body includes objectKey from step 1
 *    - Requires documents.upload permission
 *    - Validates scope and visibility
 *
 * 4. GET /documents - List documents
 *    - Filters by visibility rules (TENANT_ADMINS, RESIDENTS, PRIVATE)
 *    - RESIDENT role filtered to unit/building they occupy + tenant-wide RESIDENTS
 *    - Returns: Array of documents
 *
 * 5. GET /documents/:id - Get document detail
 *    - Validates visibility and access control
 *    - Returns: Document with file metadata
 *
 * 6. PATCH /documents/:id - Update document metadata
 *    - Only creator or admin can update
 *    - Can update: title, category, visibility
 *    - Cannot change: file/objectKey (immutable)
 *
 * 7. DELETE /documents/:id - Delete document
 *    - Only creator or admin can delete
 *    - Deletes Document + File records (cascade)
 *    - MinIO cleanup done asynchronously
 *
 * 8. GET /documents/:id/download - Get presigned download URL
 *    - Validates access before returning URL
 *    - Client downloads directly from MinIO
 *
 * Permissions:
 * - documents.read: View documents
 * - documents.upload: Create documents
 * - documents.manage: Update, delete documents
 *
 * RESIDENT Role Rules:
 * - Cannot create documents (no documents.upload)
 * - Can read documents that are:
 *   a) Tenant-wide with visibility=RESIDENTS
 *   b) Building-scoped and user occupies a unit in that building
 *   c) Unit-scoped and user occupies that unit
 *   d) Created by themselves (PRIVATE)
 */
@Controller('tenants/:tenantId/documents')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly residentAccess: ResidentAccessService,
  ) {}


  /**
   * Check if user is SUPER_ADMIN (global role across any membership)
   */
  private isSuperAdmin(
    memberships: Array<{ tenantId: string; roles: string[] }>,
  ): boolean {
    return memberships?.some((membership) => membership.roles.includes('SUPER_ADMIN')) || false;
  }

  /**
   * Get user roles from active membership (tenant context)
   */
  private getUserRoles(req: TenantContextRequest): string[] {
    return req.user.roles || [];
  }

  /**
   * Get active tenantId from request (set by TenantContext middleware)
   * In this MVP, we'll get it from user's active membership
   */
  private getTenantId(req: TenantContextRequest): string {
    return req.tenantId;
  }

  /**
   * POST /documents/presign
   * Generate presigned URL for file upload to MinIO
   *
   * Body: { originalName, mimeType }
   * Returns: { url, bucket, objectKey, expiresAt }
   *
   * No permission check (any authenticated user can presign)
   */
  @Post('presign')
  async presignUpload(
    @Body() dto: PresignUploadDto,
    @Request() req: TenantContextRequest,
  ): Promise<PresignedUrlResponse> {
    const tenantId = this.getTenantId(req);
    return await this.documentsService.presignUpload(
      tenantId,
      dto.originalName,
      dto.mimeType,
    );
  }

  /**
   * POST /documents
   * Create a document after file upload
   *
   * Body: CreateDocumentDto (includes objectKey from presign)
   * Returns: Document with file metadata
   *
   * Permission rules:
   * - Admins (TENANT_ADMIN, TENANT_OWNER, OPERATOR): can create any document
   * - RESIDENT/OWNER: can only create RECEIPT documents (payment proofs)
   *
   * Validates:
   * - Scope constraint (buildingId/unitId/both null)
   * - Building belongs to tenant
   * - Unit belongs to building
   * - ObjectKey was uploaded
   * - For residents: must have access to the unit
   */
  @Post()
  async create(
    @Body() dto: CreateDocumentDto,
    @Request() req: TenantContextRequest,
  ) {
    const tenantId = this.getTenantId(req);
    const userId = req.user.id;
    const userRoles = this.getUserRoles(req);
    const userMemberships = req.user.memberships || [];
    const isSuperAdmin = this.isSuperAdmin(userMemberships);

    const isAdmin =
      userRoles.includes('TENANT_ADMIN') ||
      userRoles.includes('TENANT_OWNER') ||
      userRoles.includes('OPERATOR');

    const enforceResidentScope = this.residentAccess.shouldEnforce(
      isSuperAdmin ? [...userRoles, 'SUPER_ADMIN'] : userRoles,
    );

    // Check if this is a payment proof (RECEIPT category)
    const isPaymentProof = dto.category === 'RECEIPT';

    // Residents can only create RECEIPT documents (payment proofs)
    if (!isAdmin && !isSuperAdmin && enforceResidentScope) {
      if (!isPaymentProof) {
        throw new ForbiddenException('Residents can only create payment proof documents');
      }
      // For payment proofs, validate unit access
      if (!dto.unitId) {
        throw new BadRequestException('Payment proof must be associated with a unit');
      }
    } else if (!isAdmin && !isSuperAdmin) {
      throw new ForbiddenException('Only admins can create documents');
    }

    // Get user membership ID
    const userMembership = userMemberships.find((membership) => membership.tenantId === tenantId);
    if (!userMembership) {
      throw new BadRequestException('Invalid tenant context');
    }

    // For residents, validate they have access to the unit
    if (enforceResidentScope && isPaymentProof && dto.unitId) {
      const hasAccess = await this.documentsService.checkResidentUnitAccess(
        tenantId,
        userId,
        dto.unitId,
      );
      if (!hasAccess) {
        throw new ForbiddenException('You do not have access to this unit');
      }
    }

    return await this.documentsService.createDocument(
      tenantId,
      userMembership.id!,
      dto,
    );
  }

  /**
   * GET /documents
   * List documents with filtering
   *
   * Query params:
   * - buildingId: Filter by building (optional)
   * - unitId: Filter by unit (optional)
   * - category: Filter by category (optional)
   * - visibility: Filter by visibility (optional)
   *
   * Returns: Array of documents visible to user
   *
   * Filters:
   * - Admins: See all documents
   * - SUPER_ADMIN: See all documents
   * - RESIDENT: See RESIDENTS visibility + building-/unit-scoped docs they have access to + PRIVATE if creator
   */
  @Get()
  async findAll(
    @Request() req: TenantContextRequest,
    @Query('buildingId') buildingId?: string,
    @Query('unitId') unitId?: string,
    @Query('category') category?: DocumentCategory,
    @Query('visibility') visibility?: DocumentVisibility,
  ) {
    const tenantId = this.getTenantId(req);
    const userId = req.user.id;
    const userRoles = this.getUserRoles(req);
    const userMemberships = req.user.memberships || [];
    const isSuperAdmin = this.isSuperAdmin(userMemberships);

    const filters: {
      buildingId?: string;
      unitId?: string;
      category?: DocumentCategory;
      visibility?: DocumentVisibility;
    } = {};
    if (buildingId) filters.buildingId = buildingId;
    if (unitId) filters.unitId = unitId;
    if (category) filters.category = category;
    if (visibility) filters.visibility = visibility;

    return await this.documentsService.listDocuments(
      tenantId,
      userId,
      userRoles,
      isSuperAdmin,
      filters,
    );
  }

  /**
   * GET /documents/:id
   * Get document detail
   *
   * Returns: Document with file metadata
   *
   * Validates: User has visibility access
   */
  @Get(':documentId')
  async findOne(
    @Param('documentId') documentId: string,
    @Request() req: TenantContextRequest,
  ) {
    const tenantId = this.getTenantId(req);
    const userId = req.user.id;
    const userRoles = this.getUserRoles(req);
    const userMemberships = req.user.memberships || [];
    const isSuperAdmin = this.isSuperAdmin(userMemberships);

    return await this.documentsService.getDocument(
      tenantId,
      documentId,
      userId,
      userRoles,
      isSuperAdmin,
    );
  }

  /**
   * PATCH /documents/:id
   * Update document metadata
   *
   * Body: UpdateDocumentDto (title, category, visibility)
   * Returns: Updated document
   *
   * Only creator or admin can update
   * Cannot change: file/objectKey (immutable)
   */
  @Patch(':documentId')
  async update(
    @Param('documentId') documentId: string,
    @Body() dto: UpdateDocumentDto,
    @Request() req: TenantContextRequest,
  ) {
    const tenantId = this.getTenantId(req);
    const userId = req.user.id;
    const userRoles = this.getUserRoles(req);

    return await this.documentsService.updateDocument(
      tenantId,
      documentId,
      userId,
      userRoles,
      dto,
    );
  }

  /**
   * DELETE /documents/:id
   * Delete document
   *
   * Only creator or admin can delete
   * Document + File deleted (cascade)
   * MinIO cleanup done asynchronously
   */
  @Delete(':documentId')
  async remove(
    @Param('documentId') documentId: string,
    @Request() req: TenantContextRequest,
  ) {
    const tenantId = this.getTenantId(req);
    const userId = req.user.id;
    const userRoles = this.getUserRoles(req);

    await this.documentsService.deleteDocument(
      tenantId,
      documentId,
      userId,
      userRoles,
    );

    return { message: 'Document deleted successfully' };
  }

  /**
   * GET /documents/:id/download
   * Get presigned download URL
   *
   * Returns: { url, expiresAt }
   *
   * Validates access before returning URL
   * Client downloads directly from MinIO using returned URL
   */
  @Get(':documentId/download')
  async getDownloadUrl(
    @Param('documentId') documentId: string,
    @Request() req: TenantContextRequest,
  ) {
    const tenantId = this.getTenantId(req);
    const userId = req.user.id;
    const userRoles = this.getUserRoles(req);
    const userMemberships = req.user.memberships || [];
    const isSuperAdmin = this.isSuperAdmin(userMemberships);

    return await this.documentsService.getDownloadUrl(
      tenantId,
      documentId,
      userId,
      userRoles,
      isSuperAdmin,
    );
  }
}
