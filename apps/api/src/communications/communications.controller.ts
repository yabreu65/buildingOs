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
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BuildingAccessGuard } from '../tenancy/building-access.guard';
import { AdminRoleGuard } from './admin-role.guard';
import { CommunicationsService, CommunicationWithDetails, FindAllFilters } from './communications.service';
import { CommunicationsValidators } from './communications.validators';
import { AuthenticatedRequest } from '../common/types/request.types';
import {
  CreateCommunicationDto,
  GetCommunicationParamDto,
  UpdateCommunicationParamDto,
  DeleteCommunicationParamDto,
  SendCommunicationParamDto,
  ListCommunicationsParamDto,
  ListCommunicationsQueryDto,
} from './dto/create-communication.dto';
import { UpdateCommunicationDto } from './dto/update-communication.dto';
import { ScheduleCommunicationDto } from './dto/schedule-communication.dto';
import { CommunicationReceipt, CommunicationTargetType } from '@prisma/client';

/**
 * CommunicationsController: Communications (Comunicados) management endpoints
 *
 * Routes:
 * - /buildings/:buildingId/communications (building-scoped)
 * - /communications/:communicationId/receipts (tenant-level)
 *
 * Security (4-layer validation):
 * 1. JwtAuthGuard: Requires valid JWT token
 * 2. BuildingAccessGuard: Validates building belongs to user's tenant
 *    - Populates req.tenantId automatically
 * 3. X-Tenant-Id header validation: BuildingAccessGuard validates user has membership
 * 4. Communications-specific scope: Service validates resource belongs to tenant
 *
 * Validation Flow:
 * 1. JWT validated (JwtAuthGuard)
 * 2. Building found and user has membership (BuildingAccessGuard)
 * 3. Building/Communication/Target scope validated (Service layer)
 * 4. Permission checks (RBAC)
 * 5. Returns 404 for all unauthorized/cross-tenant access
 *
 * Permissions:
 * - communications.read: View communications and receipts
 * - communications.publish: Create/schedule/send communications
 * - communications.manage: Edit DRAFT, delete DRAFT, reschedule (optional)
 *
 * RESIDENT Role Rules:
 * - Can only READ communications targeted to them (via CommunicationReceipt)
 * - Cannot CREATE/PUBLISH communications
 * - Cannot MANAGE communications
 *
 * ADMIN Roles (TENANT_ADMIN, TENANT_OWNER, OPERATOR):
 * - Can CREATE/READ/UPDATE/SEND/DELETE communications
 * - Can see all communications (not filtered by receipt)
 * - Can access all communications regardless of target scope
 */
@Controller('buildings/:buildingId/communications')
@UseGuards(JwtAuthGuard, BuildingAccessGuard)
export class CommunicationsController {
  constructor(
    private readonly communicationsService: CommunicationsService,
    private readonly validators: CommunicationsValidators,
  ) {}

  /** Check if user is RESIDENT */
  private isResidentRole(userRoles: string[]): boolean {
    return userRoles?.includes('RESIDENT') || false;
  }

  /**
   * POST /buildings/:buildingId/communications
   * Create a new communication (DRAFT status)
   *
   * Body: CreateCommunicationDto
   * - title: string (required)
   * - body: string (required)
   * - channel: IN_APP | EMAIL | WHATSAPP | PUSH (required)
   * - buildingId?: string (optional, overrides route param for cross-building)
   * - targets: Array<{targetType, targetId}> (required, min 1)
   *
   * Returns: Communication with targets and receipts
   *
   * Admin only: communications.publish permission required
   *
   * Validation:
   * - Building (if provided) must belong to tenant (404 if not)
   * - All targets must be valid for tenant (404 if invalid)
   * - At least one target required
   */
  @Post()
  @UseGuards(AdminRoleGuard)
  async create(
    @Param() params: ListCommunicationsParamDto,
    @Body() dto: CreateCommunicationDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<CommunicationWithDetails> {
    const tenantId = req.tenantId!;
    const userId = req.user.id;

    const buildingId = dto.buildingId || params.buildingId;

    if (buildingId) {
      await this.validators.validateBuildingBelongsToTenant(
        tenantId,
        buildingId,
      );
    }

    return await this.communicationsService.create(
      tenantId,
      userId,
      {
        title: dto.title,
        body: dto.body,
        channel: dto.channel,
        buildingId: buildingId || undefined,
        targets: dto.targets as Array<{
          targetType: CommunicationTargetType;
          targetId?: string;
        }>,
      },
    );
  }

  /**
   * GET /buildings/:buildingId/communications
   * List communications in a building
   *
   * Query filters:
   * - status: DRAFT | SCHEDULED | SENT
   * - channel: EMAIL | SMS | PUSH | IN_APP
   * - search: search in title/body
   * - sortBy: createdAt | sentAt | scheduledAt
   * - sortOrder: asc | desc
   *
   * Returns:
   * - Admin: All communications
   * - RESIDENT: Only communications they received (have receipt for)
   *
   * Requires: communications.read permission
   */
  @Get()
  async findAll(
    @Param() params: ListCommunicationsParamDto,
    @Query() query: ListCommunicationsQueryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<CommunicationWithDetails[]> {
    const tenantId = req.tenantId!;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];

    // findForUser handles admin/resident branching internally
    return await this.communicationsService.findForUser(tenantId, userId, userRoles, {
      buildingId: params.buildingId,
      status: query.status,
      channel: query.channel,
      search: query.search,
      sortBy: query.sortBy ?? 'createdAt',
      sortOrder: query.sortOrder ?? 'desc',
    });
  }

  /**
   * GET /buildings/:buildingId/communications/:communicationId
   * Get a single communication with full details
   *
   * Returns:
   * - Admin: Full communication with all targets and receipts
   * - RESIDENT: Communication only if they received it (have receipt)
   *
   * Throws: 404 if communication doesn't belong to tenant or RESIDENT can't access
   *
   * Requires: communications.read permission
   */
  @Get(':communicationId')
  async findOne(
    @Param() params: GetCommunicationParamDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<CommunicationWithDetails> {
    const tenantId = req.tenantId!;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];

    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      params.communicationId,
    );

    if (this.isResidentRole(userRoles)) {
      const canRead = await this.validators.canUserReadCommunication(
        tenantId,
        userId,
        params.communicationId,
        userRoles,
      );
      if (!canRead) {
        throw new NotFoundException('Communication not found or access denied');
      }
    }

    return await this.communicationsService.findOne(tenantId, params.communicationId);
  }

  /**
   * PATCH /buildings/:buildingId/communications/:communicationId
   * Update a communication (only DRAFT status)
   *
   * Body: UpdateCommunicationDto
   * - title?: string
   * - body?: string
   * - channel?: IN_APP | EMAIL | WHATSAPP | PUSH
   *
   * Throws:
   * - 400 if communication is not DRAFT status
   * - 404 if communication doesn't belong to tenant
   *
   * Admin only: communications.manage permission required
   *
   * Requires: communications.manage permission
   */
  @Patch(':communicationId')
  @UseGuards(AdminRoleGuard)
  async update(
    @Param() params: UpdateCommunicationParamDto,
    @Body() dto: UpdateCommunicationDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<CommunicationWithDetails> {
    const tenantId = req.tenantId!;

    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      params.communicationId,
    );

    return await this.communicationsService.update(tenantId, params.communicationId, {
      title: dto.title,
      body: dto.body,
      channel: dto.channel,
    });
  }

  /**
   * POST /buildings/:buildingId/communications/:communicationId/send
   * Send or schedule a communication (DRAFT → SENT or SCHEDULED)
   *
   * Body: ScheduleCommunicationDto
   * - scheduledAt?: Date (if provided, transitions to SCHEDULED; if not, transitions to SENT)
   *
   * Returns: Updated communication with SENT or SCHEDULED status
   *
   * Throws:
   * - 400 if scheduledAt is in the past (for scheduling)
   * - 404 if communication doesn't belong to tenant
   *
   * Admin only: communications.publish permission required
   *
   * Requires: communications.publish permission
   */
  @Post(':communicationId/send')
  @UseGuards(AdminRoleGuard)
  async send(
    @Param() params: SendCommunicationParamDto,
    @Body() dto: ScheduleCommunicationDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<CommunicationWithDetails> {
    const tenantId = req.tenantId!;

    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      params.communicationId,
    );

    if (dto.scheduledAt) {
      return await this.communicationsService.schedule(
        tenantId,
        params.communicationId,
        { scheduledAt: dto.scheduledAt },
      );
    } else {
      return await this.communicationsService.send(tenantId, params.communicationId);
    }
  }

  /**
   * DELETE /buildings/:buildingId/communications/:communicationId
   * Delete a communication (only DRAFT status)
   *
   * Throws:
   * - 400 if communication is not DRAFT status
   * - 404 if communication doesn't belong to tenant
   *
   * Admin only: communications.manage permission required
   *
   * Requires: communications.manage permission
   */
  @Delete(':communicationId')
  @UseGuards(AdminRoleGuard)
  async remove(
    @Param() params: DeleteCommunicationParamDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<CommunicationWithDetails> {
    const tenantId = req.tenantId!;

    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      params.communicationId,
    );

    return await this.communicationsService.delete(tenantId, params.communicationId);
  }

  /**
   * GET /buildings/:buildingId/communications/:communicationId/receipts
   * Get all receipts (delivery status) for a communication
   *
   * Returns array of receipts with:
   * - userId
   * - deliveredAt (timestamp or null)
   * - readAt (timestamp or null)
   *
   * Admin only: RESIDENT cannot view receipt list
   *
   * Requires: communications.read permission
   */
  @Get(':communicationId/receipts')
  @UseGuards(AdminRoleGuard)
  async getReceipts(
    @Param() params: GetCommunicationParamDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<CommunicationReceipt[]> {
    const tenantId = req.tenantId!;

    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      params.communicationId,
    );

    const communication = await this.communicationsService.findOne(
      tenantId,
      params.communicationId,
    );
    return communication.receipts ?? [];
  }
}
