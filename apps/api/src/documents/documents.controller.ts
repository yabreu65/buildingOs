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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DocumentsService } from './documents.service';
import { PresignUploadDto, PresignedUrlResponse } from './dto/presign-upload.dto';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';

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
@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private documentsService: DocumentsService) {}

  /**
   * Check if user has RESIDENT role
   */
  private isResidentRole(userRoles: string[]): boolean {
    return userRoles?.includes('RESIDENT') || false;
  }

  /**
   * Check if user is SUPER_ADMIN (global role across any membership)
   */
  private isSuperAdmin(memberships: any[]): boolean {
    return memberships?.some((m) =>
      m.roles?.some((r: any) => r.role === 'SUPER_ADMIN'),
    ) || false;
  }

  /**
   * Get user roles from active membership (tenant context)
   */
  private getUserRoles(req: any): string[] {
    return req.user.roles || [];
  }

  /**
   * Get active tenantId from request (set by TenantContext middleware)
   * In this MVP, we'll get it from user's active membership
   */
  private getTenantId(req: any): string {
    return req.tenantId || req.user.tenantId;
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
    @Request() req: any,
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
   * Requires: documents.upload permission (admin only, not RESIDENT)
   *
   * Validates:
   * - Scope constraint (buildingId/unitId/both null)
   * - Building belongs to tenant
   * - Unit belongs to building
   * - ObjectKey was uploaded
   */
  @Post()
  async create(
    @Body() dto: CreateDocumentDto,
    @Request() req: any,
  ) {
    const tenantId = this.getTenantId(req);
    const userId = req.user.id;
    const userRoles = this.getUserRoles(req);
    const userMemberships = req.user.memberships || [];
    const isSuperAdmin = this.isSuperAdmin(userMemberships);

    // Only admins and SUPER_ADMIN can create documents
    const isAdmin =
      userRoles.includes('TENANT_ADMIN') ||
      userRoles.includes('TENANT_OWNER') ||
      userRoles.includes('OPERATOR');

    if (!isAdmin && !isSuperAdmin) {
      throw new ForbiddenException('Only admins can create documents');
    }

    // Get user membership ID
    const userMembership = userMemberships.find((m: any) => m.tenantId === tenantId);
    if (!userMembership) {
      throw new BadRequestException('Invalid tenant context');
    }

    return await this.documentsService.createDocument(
      tenantId,
      userMembership.id,
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
    @Query('buildingId') buildingId?: string,
    @Query('unitId') unitId?: string,
    @Query('category') category?: string,
    @Query('visibility') visibility?: string,
    @Request() req?: any,
  ) {
    const tenantId = this.getTenantId(req);
    const userId = req.user.id;
    const userRoles = this.getUserRoles(req);
    const userMemberships = req.user.memberships || [];
    const isSuperAdmin = this.isSuperAdmin(userMemberships);

    const filters: any = {};
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
    @Request() req: any,
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
    @Request() req: any,
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
    @Request() req: any,
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
    @Request() req: any,
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
