import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Request,
  Query,
  Header,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CommunicationsService } from './communications.service';
import { CommunicationsValidators } from './communications.validators';
import { CommunicationStatus } from '@prisma/client';

/**
 * CommunicationsUserController: Tenant-level and user-level Communications endpoints
 *
 * Routes:
 * - GET /communications - List all communications (tenant, admin only)
 * - GET /communications/:communicationId - Get detail (admin only)
 * - GET /me/communications - Inbox for current user
 * - POST /me/communications/:communicationId/read - Mark as read
 *
 * Security:
 * 1. JwtAuthGuard: Requires valid JWT token
 * 2. X-Tenant-Id header: Required for admin routes, auto-extracted for /me
 * 3. Service validates scope (communication belongs to tenant)
 * 4. /me routes: User can only access their own communications
 *
 * Permissions:
 * - /communications: Admin only (communications.read required)
 * - /me/communications: Any authenticated user
 */
@Controller('communications')
@UseGuards(JwtAuthGuard)
export class CommunicationsUserController {
  constructor(
    private communicationsService: CommunicationsService,
    private validators: CommunicationsValidators,
  ) {}

  /**
   * Check if user has admin roles
   */
  private isAdminRole(userRoles: string[]): boolean {
    const adminRoles = ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'];
    return userRoles?.some((r) => adminRoles.includes(r)) || false;
  }

  /**
   * GET /communications
   * List all communications in tenant (admin only)
   *
   * Query filters:
   * - buildingId: filter by building
   * - status: DRAFT | SCHEDULED | SENT
   *
   * Returns:
   * - Admin: All communications in tenant
   *
   * Requires: communications.read + admin role + X-Tenant-Id header
   */
  @Get()
  async listCommunications(
    @Query('buildingId') buildingId?: string,
    @Query('status') status?: CommunicationStatus,
    @Request() req?: any,
  ) {
    // Extract X-Tenant-Id from request headers
    const xTenantId = req.headers['x-tenant-id'];
    if (!xTenantId) {
      throw new BadRequestException('X-Tenant-Id header is required');
    }

    // Get user's memberships to find matching tenant
    const userMemberships = req.user?.memberships || [];
    const membership = userMemberships.find((m) => m.tenantId === xTenantId);
    if (!membership) {
      throw new BadRequestException(
        'User does not have membership in the specified tenant',
      );
    }

    const tenantId = xTenantId;
    const userRoles = membership.roles || [];
    if (!this.isAdminRole(userRoles)) {
      throw new BadRequestException('Only administrators can list communications');
    }

    const filters: any = {};
    if (buildingId) {
      // Validate building belongs to tenant
      await this.validators.validateBuildingBelongsToTenant(
        tenantId,
        buildingId,
      );
      filters.buildingId = buildingId;
    }
    if (status) filters.status = status;

    return await this.communicationsService.findAll(tenantId, filters);
  }

  /**
   * GET /communications/:communicationId
   * Get communication detail (admin only)
   *
   * Returns full communication with targets and receipts
   *
   * Throws 404 if communication doesn't belong to tenant
   *
   * Requires: communications.read + admin role + X-Tenant-Id header
   */
  @Get(':communicationId')
  async getCommunication(
    @Param('communicationId') communicationId: string,
    @Request() req?: any,
  ) {
    // Extract X-Tenant-Id from request headers
    const xTenantId = req.headers['x-tenant-id'];
    if (!xTenantId) {
      throw new BadRequestException('X-Tenant-Id header is required');
    }

    // Get user's memberships to find matching tenant
    const userMemberships = req.user?.memberships || [];
    const membership = userMemberships.find((m) => m.tenantId === xTenantId);
    if (!membership) {
      throw new BadRequestException(
        'User does not have membership in the specified tenant',
      );
    }

    const tenantId = xTenantId;
    const userRoles = membership.roles || [];
    if (!this.isAdminRole(userRoles)) {
      throw new BadRequestException('Only administrators can view communications');
    }

    // Validate scope
    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      communicationId,
    );

    return await this.communicationsService.findOne(tenantId, communicationId);
  }
}

/**
 * CommunicationsInboxController: User inbox routes (/me/communications)
 *
 * Routes:
 * - GET /me/communications - List communications for current user
 * - POST /me/communications/:communicationId/read - Mark communication as read
 *
 * Security:
 * 1. JwtAuthGuard: Requires valid JWT
 * 2. No X-Tenant-Id header needed (uses user's tenant from JWT)
 * 3. User can only see/interact with communications targeted to them
 *
 * RESIDENT Workflow:
 * - User views their inbox (only communications with receipt)
 * - User opens communication to read details
 * - User marks as read
 */
@Controller('me/communications')
@UseGuards(JwtAuthGuard)
export class CommunicationsInboxController {
  constructor(
    private communicationsService: CommunicationsService,
    private validators: CommunicationsValidators,
  ) {}

  /**
   * GET /me/communications
   * List communications in user's inbox
   *
   * Query filters:
   * - buildingId: filter by building (optional)
   * - unitId: filter by unit (optional)
   * - readOnly: show only unread (false) or read (true) (optional)
   *
   * Returns:
   * - Only communications targeted to current user (have receipt)
   * - Includes receipt details (deliveredAt, readAt)
   *
   * No permission required (authenticated users only)
   */
  @Get()
  async getInbox(
    @Query('buildingId') buildingId?: string,
    @Query('unitId') unitId?: string,
    @Query('readOnly') readOnly?: string,
    @Request() req?: any,
  ) {
    // Get user's primary tenant membership
    const userMemberships = req.user?.memberships || [];
    if (userMemberships.length === 0) {
      throw new BadRequestException('User does not have a tenant membership');
    }

    const tenantId = userMemberships[0].tenantId;
    const userId = req.user.id;
    const userRoles = userMemberships[0].roles || [];

    // Validate building if provided
    const filters: any = {};
    if (buildingId) {
      await this.validators.validateBuildingBelongsToTenant(
        tenantId,
        buildingId,
      );
      filters.buildingId = buildingId;
    }

    // For now, unitId filter is accepted but not validated (UX feature)
    // In production, validate unit belongs to tenant if needed
    if (unitId) {
      filters.unitId = unitId;
    }

    if (readOnly) {
      filters.readOnly = readOnly === 'true';
    }

    // Service returns only communications where user has receipt
    return await this.communicationsService.findForUser(
      tenantId,
      userId,
      userRoles,
      filters,
    );
  }

  /**
   * GET /me/communications/:communicationId
   * Get communication detail for current user
   *
   * Returns communication only if user received it (has receipt)
   * Includes their receipt status (deliveredAt, readAt)
   *
   * Throws 404 if:
   * - Communication doesn't exist
   * - User didn't receive it (no receipt)
   *
   * No permission required (authenticated users only)
   */
  @Get(':communicationId')
  async getCommunicationDetail(
    @Param('communicationId') communicationId: string,
    @Request() req: any,
  ) {
    // Get user's primary tenant membership
    const userMemberships = req.user?.memberships || [];
    if (userMemberships.length === 0) {
      throw new BadRequestException('User does not have a tenant membership');
    }

    const tenantId = userMemberships[0].tenantId;
    const userId = req.user.id;
    const userRoles = userMemberships[0].roles || [];

    // Validate communication belongs to tenant
    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      communicationId,
    );

    // Check if user can read this communication (has receipt or is admin)
    const canRead = await this.validators.canUserReadCommunication(
      tenantId,
      userId,
      communicationId,
      userRoles,
    );

    if (!canRead) {
      throw new BadRequestException(
        'Communication not found or you do not have access to it',
      );
    }

    return await this.communicationsService.findOne(tenantId, communicationId);
  }

  /**
   * POST /me/communications/:communicationId/read
   * Mark communication as read
   *
   * Updates receipt.readAt = now
   * Idempotent: if already read, no change
   *
   * Returns: { success: true, readAt: timestamp }
   *
   * Throws 404 if:
   * - Communication doesn't exist
   * - User didn't receive it (no receipt)
   *
   * No permission required (authenticated users only)
   */
  @Post(':communicationId/read')
  @HttpCode(200)
  async markAsRead(
    @Param('communicationId') communicationId: string,
    @Request() req: any,
  ) {
    // Get user's primary tenant membership
    const userMemberships = req.user?.memberships || [];
    if (userMemberships.length === 0) {
      throw new BadRequestException('User does not have a tenant membership');
    }

    const tenantId = userMemberships[0].tenantId;
    const userId = req.user.id;
    const userRoles = userMemberships[0].roles || [];

    // Validate communication belongs to tenant
    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      communicationId,
    );

    // Check if user can read this communication (has receipt)
    const canRead = await this.validators.canUserReadCommunication(
      tenantId,
      userId,
      communicationId,
      userRoles,
    );

    if (!canRead) {
      throw new BadRequestException(
        'Communication not found or you do not have access to it',
      );
    }

    // Mark as read
    await this.communicationsService.markAsRead(
      tenantId,
      userId,
      communicationId,
    );

    return {
      success: true,
      communicationId,
      readAt: new Date(),
    };
  }
}
