import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  UseGuards,
  Request,
  Query,
  Body,
  BadRequestException,
  HttpCode,
  UnprocessableEntityException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CommunicationsService } from './communications.service';
import { CommunicationsValidators } from './communications.validators';
import { CommunicationStatus } from '@prisma/client';
import {
  ResidentCommunicationListResponse,
  CreateCommunicationRequestSchema,
  PublishCommunicationRequestSchema,
  ResidentCommunicationsQuerySchema,
} from '@buildingos/contracts';
import { AuthenticatedRequest } from '../common/types/request.types';
import { resolveTenantId } from '../common/tenant-context/tenant-context.resolver';

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

  private getTenantMembershipContext(req: AuthenticatedRequest): {
    tenantId: string;
    roles: string[];
  } {
    const tenantId = resolveTenantId(req, {
      allowHeaderFallback: true,
      allowSingleMembershipFallback: false,
      requireMembership: true,
    });

    const membership = req.user.memberships?.find((m) => m.tenantId === tenantId);

    if (!membership) {
      throw new BadRequestException('User does not have membership in the specified tenant');
    }

    return {
      tenantId,
      roles: membership.roles || [],
    };
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
    @Request() req: AuthenticatedRequest,
    @Query('buildingId') buildingId?: string,
    @Query('status') status?: CommunicationStatus,
  ) {
    const { tenantId, roles: userRoles } = this.getTenantMembershipContext(req);
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
    @Request() req: AuthenticatedRequest,
  ) {
    const { tenantId, roles: userRoles } = this.getTenantMembershipContext(req);
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

  /**
   * POST /communications
   * Create a new communication (admin only)
   *
   * Body: CreateCommunicationRequest (discriminatedUnion by scopeType)
   * - title, body, status, priority, scopeType
   * - scopeType BUILDING: requires buildingId
   * - scopeType MULTI_BUILDING: requires buildingIds array
   * - scopeType TENANT_ALL: no additional fields
   *
   * If status=PUBLISHED:
   * - Sets publishedAt=now() (mapped to sentAt internally)
   * - Creates communication_deliveries with UNREAD status
   * - sendWebPush defaults to false (no push from this endpoint)
   *
   * Requires: admin role + X-Tenant-Id header
   */
  @Post()
  async createCommunication(
    @Body() rawBody: unknown,
    @Request() req: AuthenticatedRequest,
  ) {
    const { tenantId, roles: userRoles } = this.getTenantMembershipContext(req);
    if (!this.isAdminRole(userRoles)) {
      throw new BadRequestException('Only administrators can create communications');
    }

    const parsed = CreateCommunicationRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid request body',
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const input = parsed.data;
    const userId = req.user.id;

    return await this.communicationsService.createV2(
      tenantId as string,
      userId,
      {
        title: input.title,
        body: input.body,
        status: input.status,
        priority: input.priority,
        scopeType: input.scopeType,
        buildingId: input.scopeType === 'BUILDING' ? input.buildingId : undefined,
        buildingIds: input.scopeType === 'MULTI_BUILDING' ? input.buildingIds : undefined,
      },
      false,
    );
  }

  /**
   * POST /communications/:communicationId/publish
   * Publish a communication with optional web push
   *
   * Body: { sendWebPush: boolean }
   *
   * Anti-spam rule (behind feature flag enforceUrgentForWebPush, default true):
   * - If sendWebPush=true, priority must be URGENT
   * - Returns 422 with code WEB_PUSH_REQUIRES_URGENT if violated
   *
   * If sendWebPush=true:
   * - Sends WEB_PUSH only to users with active PushSubscription
   * - If no subscriptions, does NOT fail (silent no-op)
   *
   * Requires: admin role + X-Tenant-Id header
   */
  @Post(':communicationId/publish')
  async publishCommunication(
    @Param('communicationId') communicationId: string,
    @Body() rawBody: unknown,
    @Request() req: AuthenticatedRequest,
  ) {
    const { tenantId, roles: userRoles } = this.getTenantMembershipContext(req);
    if (!this.isAdminRole(userRoles)) {
      throw new BadRequestException('Only administrators can publish communications');
    }

    const parsed = PublishCommunicationRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid request body',
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const { sendWebPush } = parsed.data;

    return await this.communicationsService.publishV2(
      tenantId as string,
      communicationId,
      sendWebPush,
    );
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

  private getUserTenantContext(req: AuthenticatedRequest): {
    tenantId: string;
    userId: string;
    userRoles: string[];
  } {
    const tenantId = resolveTenantId(req, {
      allowHeaderFallback: true,
      allowSingleMembershipFallback: true,
      requireMembership: true,
    });

    const membership = req.user.memberships?.find((m) => m.tenantId === tenantId);
    if (!membership) {
      throw new BadRequestException('User does not have a tenant membership');
    }

    return {
      tenantId,
      userId: req.user.id,
      userRoles: membership.roles || [],
    };
  }

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
    @Request() req: AuthenticatedRequest,
    @Query('buildingId') buildingId?: string,
    @Query('unitId') unitId?: string,
    @Query('readOnly') readOnly?: string,
  ) {
    const { tenantId, userId, userRoles } = this.getUserTenantContext(req);

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
    @Request() req: AuthenticatedRequest,
  ) {
    const { tenantId, userId, userRoles } = this.getUserTenantContext(req);

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
    @Request() req: AuthenticatedRequest,
  ) {
    const { tenantId, userId, userRoles } = this.getUserTenantContext(req);

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

  /**
   * POST /resident/communications/:communicationId/read
   * Mark communication as read (idempotent)
   *
   * Returns: { readAt: Date | null }
   *
   * No permission required (authenticated users only)
   */
  @Post('resident/communications/:communicationId/read')
  async markResidentAsRead(
    @Param('communicationId') communicationId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<{ readAt: Date | null }> {
    const { tenantId, userId } = this.getUserTenantContext(req);

    // Validate communication belongs to tenant
    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      communicationId,
    );

    return await this.communicationsService.markAsReadForResident(
      tenantId,
      userId,
      communicationId,
    );
  }
}

/**
 * ResidentCommunicationsController: Public resident endpoints (/resident/communications)
 *
 * Routes:
 * - GET /resident/communications - List communications for resident (inbox)
 * - POST /resident/communications/:communicationId/read - Mark as read
 *
 * Security:
 * 1. JwtAuthGuard: Requires valid JWT token
 * 2. User can only see/interact with communications they received
 */
@Controller('resident')
@UseGuards(JwtAuthGuard)
export class ResidentCommunicationsController {
  constructor(
    private communicationsService: CommunicationsService,
    private validators: CommunicationsValidators,
  ) {}

  private getResidentTenantContext(req: AuthenticatedRequest): {
    tenantId: string;
    userId: string;
  } {
    const tenantId = resolveTenantId(req, {
      allowHeaderFallback: true,
      allowSingleMembershipFallback: true,
      requireMembership: true,
    });

    return {
      tenantId,
      userId: req.user.id,
    };
  }

  /**
   * GET /resident/communications
   * Resident inbox with cursor pagination
   *
   * Query params:
   * - limit: number (default 20, max 100)
   * - cursor: opaque cursor string (base64 encoded)
   *
   * Returns: { items: [...], nextCursor?: string }
   *
   * Ordering: publishedAt DESC, id DESC (mapped to sentAt internally)
   *
   * No permission required (authenticated users only)
   */
  @Get('communications')
  async getResidentCommunications(
    @Query() rawQuery: Record<string, unknown>,
    @Request() req: AuthenticatedRequest,
  ): Promise<ResidentCommunicationListResponse> {
    const userMemberships = req.user?.memberships;
    if (!userMemberships || userMemberships.length === 0) {
      throw new BadRequestException('User does not have a tenant membership');
    }

    const parsedQuery = ResidentCommunicationsQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) {
      throw new BadRequestException({
        message: 'Invalid query parameters',
        errors: parsedQuery.error.flatten().fieldErrors,
      });
    }

    const { limit, cursor } = parsedQuery.data;
    const { tenantId, userId } = this.getResidentTenantContext(req);

    return await this.communicationsService.findForResidentV2(
      tenantId,
      userId,
      limit,
      cursor,
    );
  }

  /**
   * POST /resident/communications/:communicationId/read
   * Mark communication as read (idempotent)
   *
   * Returns: { readAt: Date | null }
   *
   * No permission required (authenticated users only)
   */
  @Post('communications/:communicationId/read')
  async markResidentAsRead(
    @Param('communicationId') communicationId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<{ readAt: Date | null }> {
    const userMemberships = req.user?.memberships;
    if (!userMemberships || userMemberships.length === 0) {
      throw new BadRequestException('User does not have a tenant membership');
    }

    const { tenantId, userId } = this.getResidentTenantContext(req);

    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      communicationId,
    );

    return await this.communicationsService.markAsReadForResident(
      tenantId,
      userId,
      communicationId,
    );
  }
}
