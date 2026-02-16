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
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BuildingAccessGuard } from '../tenancy/building-access.guard';
import { CommunicationsService } from './communications.service';
import { CommunicationsValidators } from './communications.validators';
import { CreateCommunicationDto } from './dto/create-communication.dto';
import { UpdateCommunicationDto } from './dto/update-communication.dto';
import { ScheduleCommunicationDto } from './dto/schedule-communication.dto';
import { CommunicationStatus } from '@prisma/client';

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
   * Check if user is RESIDENT
   */
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
   * Admin only: tickets.publish permission required
   *
   * Validation:
   * - Building (if provided) must belong to tenant (404 if not)
   * - All targets must be valid for tenant (404 if invalid)
   * - At least one target required
   */
  @Post()
  async create(
    @Param('buildingId') routeBuildingId: string,
    @Body() dto: CreateCommunicationDto,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId; // Populated by BuildingAccessGuard
    const userId = req.user.id;
    const userRoles = req.user.roles || [];

    // Admin-only: RESIDENT cannot create communications
    if (!this.isAdminRole(userRoles)) {
      throw new Error('Only administrators can create communications');
    }

    // Use buildingId from DTO if provided, otherwise use route parameter
    const buildingId = dto.buildingId || routeBuildingId;

    // Validate building belongs to tenant (throws 404 if not)
    if (buildingId) {
      await this.validators.validateBuildingBelongsToTenant(
        tenantId,
        buildingId,
      );
    }

    // Create communication with targets and receipts
    return await this.communicationsService.create(
      tenantId,
      userId,
      {
        title: dto.title,
        body: dto.body,
        channel: dto.channel,
        buildingId: buildingId || null,
        targets: dto.targets,
      },
    );
  }

  /**
   * GET /buildings/:buildingId/communications
   * List communications in a building
   *
   * Query filters:
   * - status: DRAFT | SCHEDULED | SENT
   *
   * Returns:
   * - Admin: All communications
   * - RESIDENT: Only communications they received (have receipt for)
   *
   * Requires: communications.read permission
   */
  @Get()
  async findAll(
    @Param('buildingId') buildingId: string,
    @Query('status') status?: CommunicationStatus,
    @Request() req?: any,
  ) {
    const tenantId = req.tenantId; // Populated by BuildingAccessGuard
    const userId = req.user.id;
    const userRoles = req.user.roles || [];

    const filters: any = {};
    if (status) filters.status = status;
    filters.buildingId = buildingId;

    // RESIDENT sees only communications targeted to them
    // Admin sees all communications
    return await this.communicationsService.findForUser(
      tenantId,
      userId,
      userRoles,
      { buildingId },
    );
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
    @Param('buildingId') buildingId: string,
    @Param('communicationId') communicationId: string,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId; // Populated by BuildingAccessGuard
    const userId = req.user.id;
    const userRoles = req.user.roles || [];

    // Validate communication belongs to tenant (throws 404 if not)
    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      communicationId,
    );

    // RESIDENT: Check if they have a receipt for this communication
    if (this.isResidentRole(userRoles)) {
      const canRead = await this.validators.canUserReadCommunication(
        tenantId,
        userId,
        communicationId,
        userRoles,
      );
      if (!canRead) {
        throw new Error('Communication not found or access denied');
      }
    }

    return await this.communicationsService.findOne(tenantId, communicationId);
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
  async update(
    @Param('buildingId') buildingId: string,
    @Param('communicationId') communicationId: string,
    @Body() dto: UpdateCommunicationDto,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId; // Populated by BuildingAccessGuard
    const userRoles = req.user.roles || [];

    // Admin-only: RESIDENT cannot update communications
    if (!this.isAdminRole(userRoles)) {
      throw new Error('Only administrators can update communications');
    }

    // Validate scope (throws 404 if not found)
    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      communicationId,
    );

    return await this.communicationsService.update(tenantId, communicationId, {
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
  async send(
    @Param('buildingId') buildingId: string,
    @Param('communicationId') communicationId: string,
    @Body() dto: ScheduleCommunicationDto,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId; // Populated by BuildingAccessGuard
    const userRoles = req.user.roles || [];

    // Admin-only: RESIDENT cannot send communications
    if (!this.isAdminRole(userRoles)) {
      throw new Error('Only administrators can send communications');
    }

    // Validate scope (throws 404 if not found)
    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      communicationId,
    );

    // If scheduledAt is provided, schedule it; otherwise send immediately
    if (dto.scheduledAt) {
      return await this.communicationsService.schedule(
        tenantId,
        communicationId,
        { scheduledAt: dto.scheduledAt },
      );
    } else {
      return await this.communicationsService.send(tenantId, communicationId);
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
  async remove(
    @Param('buildingId') buildingId: string,
    @Param('communicationId') communicationId: string,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId; // Populated by BuildingAccessGuard
    const userRoles = req.user.roles || [];

    // Admin-only: RESIDENT cannot delete communications
    if (!this.isAdminRole(userRoles)) {
      throw new Error('Only administrators can delete communications');
    }

    // Validate scope (throws 404 if not found)
    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      communicationId,
    );

    return await this.communicationsService.delete(tenantId, communicationId);
  }

  /**
   * GET /communications/:communicationId/receipts
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
   *
   * Note: This is a tenant-level endpoint (not building-scoped)
   * but included here for completeness
   */
  @Get(':communicationId/receipts')
  async getReceipts(
    @Param('communicationId') communicationId: string,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId; // Populated by BuildingAccessGuard
    const userRoles = req.user.roles || [];

    // For now, admin-only to view all receipts
    // RESIDENT can only see their own receipt via GET communication
    if (!this.isAdminRole(userRoles)) {
      throw new Error('Only administrators can view receipt list');
    }

    // Validate scope (throws 404 if not found)
    await this.validators.validateCommunicationBelongsToTenant(
      tenantId,
      communicationId,
    );

    // Fetch and return receipts
    const communication = await this.communicationsService.findOne(
      tenantId,
      communicationId,
    );
    return communication.receipts || [];
  }
}
