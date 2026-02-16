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
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BuildingAccessGuard } from '../tenancy/building-access.guard';
import { TicketsService } from './tickets.service';
import { TicketStateMachine } from './tickets.state-machine';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { UpdateTicketStatusDto } from './dto/update-ticket-status.dto';
import { AddTicketCommentDto } from './dto/add-ticket-comment.dto';

/**
 * TicketsController: Tickets management endpoints
 *
 * Routes: /buildings/:buildingId/tickets
 *
 * Security:
 * 1. JwtAuthGuard: Requires valid JWT token
 * 2. BuildingAccessGuard: Validates building belongs to user's tenant
 *    - Populates req.tenantId automatically
 * 3. Service layer validates building/ticket/unit scope
 * 4. RESIDENT role scope enforcement: RESIDENT can only access tickets from units they're assigned to
 *
 * Validation Flow:
 * 1. JWT validated (JwtAuthGuard)
 * 2. Building found and user has membership (BuildingAccessGuard)
 * 3. Building/Unit/Ticket scope validated (Service layer)
 * 4. RESIDENT role scope validated (Controller + Service)
 * 5. Returns 404 for cross-tenant, cross-building, or cross-unit access
 *
 * Permissions:
 * - tickets.read: View tickets
 * - tickets.create: Create tickets
 * - tickets.manage: Assign, change status, update
 *
 * RESIDENT Role Rules:
 * - Can only access tickets from units where they have active UnitOccupant assignment
 * - For LIST: unitId filter must be in their accessible units, or 404
 * - For CREATE: unitId must be in their accessible units, or 400/404
 * - For GET detail: ticket.unitId must be in their accessible units, or 404
 * - For COMMENT: ticket's unit must be accessible, or 404
 */
@Controller('buildings/:buildingId/tickets')
@UseGuards(JwtAuthGuard, BuildingAccessGuard)
export class TicketsController {
  constructor(private ticketsService: TicketsService) {}

  /**
   * Check if user has RESIDENT role in their current memberships
   */
  private isResidentRole(userRoles: string[]): boolean {
    return userRoles?.includes('RESIDENT') || false;
  }

  /**
   * POST /buildings/:buildingId/tickets
   * Create a new ticket
   *
   * Body: CreateTicketDto
   * Returns: Ticket with full details
   *
   * RESIDENT users can only create tickets if:
   * - No unitId provided, OR
   * - unitId is one of their assigned units
   *
   * Requires: tickets.create permission
   */
  @Post()
  async create(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateTicketDto,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId; // Populated by BuildingAccessGuard
    const userId = req.user.id;
    const userRoles = req.user.roles || [];

    // RESIDENT role: validate unitId if provided
    if (this.isResidentRole(userRoles) && dto.unitId) {
      await this.ticketsService.validateResidentUnitAccess(
        tenantId,
        userId,
        dto.unitId,
      );
    }

    return await this.ticketsService.create(
      tenantId,
      buildingId,
      userId,
      dto,
    );
  }

  /**
   * GET /buildings/:buildingId/tickets
   * List all tickets in a building
   *
   * Query filters:
   * - status: OPEN|IN_PROGRESS|RESOLVED|CLOSED
   * - priority: LOW|MEDIUM|HIGH|URGENT
   * - unitId: filter by unit
   * - assignedToMembership: filter by assigned user
   *
   * RESIDENT users can only filter by unitId if that unit is one of their assigned units.
   * If unitId filter is provided but not accessible by RESIDENT, returns 404.
   *
   * Requires: tickets.read permission
   */
  @Get()
  async findAll(
    @Param('buildingId') buildingId: string,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('unitId') unitId?: string,
    @Query('assignedToMembership') assignedToMembership?: string,
    @Request() req?: any,
  ) {
    const tenantId = req.tenantId; // Populated by BuildingAccessGuard
    const userId = req.user.id;
    const userRoles = req.user.roles || [];

    // RESIDENT role: validate unitId filter if provided
    if (this.isResidentRole(userRoles) && unitId) {
      await this.ticketsService.validateResidentUnitAccess(
        tenantId,
        userId,
        unitId,
      );
    }

    const filters: any = {};
    if (status) filters.status = status;
    if (priority) filters.priority = priority;
    if (unitId) filters.unitId = unitId;
    if (assignedToMembership) filters.assignedToMembershipId = assignedToMembership;

    return await this.ticketsService.findAll(tenantId, buildingId, filters);
  }

  /**
   * GET /buildings/:buildingId/tickets/:ticketId
   * Get a single ticket with all comments
   *
   * RESIDENT users can only view tickets from units they're assigned to.
   * If ticket.unitId is not accessible by RESIDENT, returns 404.
   *
   * Requires: tickets.read permission
   */
  @Get(':ticketId')
  async findOne(
    @Param('buildingId') buildingId: string,
    @Param('ticketId') ticketId: string,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId; // Populated by BuildingAccessGuard
    const userId = req.user.id;
    const userRoles = req.user.roles || [];

    // First fetch the ticket to get its unitId
    const ticket = await this.ticketsService.findOne(tenantId, buildingId, ticketId);

    // RESIDENT role: validate ticket's unit is accessible
    if (this.isResidentRole(userRoles) && ticket.unitId) {
      await this.ticketsService.validateResidentUnitAccess(
        tenantId,
        userId,
        ticket.unitId,
      );
    }

    return ticket;
  }

  /**
   * PATCH /buildings/:buildingId/tickets/:ticketId
   * Update a ticket
   *
   * Body: UpdateTicketDto
   * - title?, description?, category?: free fields
   * - priority?: LOW|MEDIUM|HIGH|URGENT
   * - status?: OPEN|IN_PROGRESS|RESOLVED|CLOSED
   * - unitId?: reassign unit
   * - assignedToMembershipId?: reassign to member
   *
   * Status transitions are validated (see TicketStateMachine)
   *
   * Requires: tickets.manage permission
   */
  @Patch(':ticketId')
  async update(
    @Param('buildingId') buildingId: string,
    @Param('ticketId') ticketId: string,
    @Body() dto: UpdateTicketDto,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId; // Populated by BuildingAccessGuard

    // If status is changing, validate transition first
    if (dto.status) {
      const ticket = await this.ticketsService.findOne(tenantId, buildingId, ticketId);
      TicketStateMachine.validateTransition(ticket.status, dto.status);
    }

    return await this.ticketsService.update(
      tenantId,
      buildingId,
      ticketId,
      dto,
    );
  }

  /**
   * DELETE /buildings/:buildingId/tickets/:ticketId
   * Delete a ticket (cascade deletes comments)
   *
   * Requires: tickets.manage permission
   */
  @Delete(':ticketId')
  async remove(
    @Param('buildingId') buildingId: string,
    @Param('ticketId') ticketId: string,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId; // Populated by BuildingAccessGuard
    return await this.ticketsService.remove(tenantId, buildingId, ticketId);
  }

  /**
   * POST /buildings/:buildingId/tickets/:ticketId/comments
   * Add a comment to a ticket
   *
   * Body: AddTicketCommentDto
   * Returns: Comment with author details
   *
   * RESIDENT users can only comment on tickets from units they're assigned to.
   * If ticket.unitId is not accessible by RESIDENT, returns 404.
   *
   * Requires: tickets.read (comment on any ticket) or tickets.manage
   */
  @Post(':ticketId/comments')
  async addComment(
    @Param('buildingId') buildingId: string,
    @Param('ticketId') ticketId: string,
    @Body() dto: AddTicketCommentDto,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId; // Populated by BuildingAccessGuard
    const userId = req.user.id;
    const userRoles = req.user.roles || [];

    // RESIDENT role: verify ticket's unit is accessible before allowing comment
    if (this.isResidentRole(userRoles)) {
      // Fetch ticket to check its unitId
      const ticket = await this.ticketsService.findOne(tenantId, buildingId, ticketId);
      if (ticket.unitId) {
        await this.ticketsService.validateResidentUnitAccess(
          tenantId,
          userId,
          ticket.unitId,
        );
      }
    }

    return await this.ticketsService.addComment(
      tenantId,
      buildingId,
      ticketId,
      userId,
      dto,
    );
  }

  /**
   * GET /buildings/:buildingId/tickets/:ticketId/comments
   * Get all comments for a ticket
   *
   * Returns: Array of comments ordered by creation time (asc)
   *
   * Requires: tickets.read permission
   */
  @Get(':ticketId/comments')
  async getComments(
    @Param('buildingId') buildingId: string,
    @Param('ticketId') ticketId: string,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId; // Populated by BuildingAccessGuard
    return await this.ticketsService.getComments(tenantId, buildingId, ticketId);
  }

}
