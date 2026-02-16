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
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
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
 * - Requires JWT authentication (JwtAuthGuard)
 * - Requires tenant membership (TenantAccessGuard)
 * - Service layer validates building/ticket/unit scope
 *
 * Permissions:
 * - tickets.read: View tickets
 * - tickets.create: Create tickets
 * - tickets.manage: Assign, change status, update
 */
@Controller('buildings/:buildingId/tickets')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class TicketsController {
  constructor(private ticketsService: TicketsService) {}

  /**
   * POST /buildings/:buildingId/tickets
   * Create a new ticket
   *
   * Body: CreateTicketDto
   * Returns: Ticket with full details
   *
   * Requires: tickets.create permission
   */
  @Post()
  async create(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateTicketDto,
    @Request() req: any,
  ) {
    const tenantId = req.user.tenantId || this.getTenantIdFromMembership(req.user);
    return await this.ticketsService.create(
      tenantId,
      buildingId,
      req.user.id,
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
    const tenantId = req?.user?.tenantId || this.getTenantIdFromMembership(req?.user);
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
   * Requires: tickets.read permission
   */
  @Get(':ticketId')
  async findOne(
    @Param('buildingId') buildingId: string,
    @Param('ticketId') ticketId: string,
    @Request() req: any,
  ) {
    const tenantId = req.user.tenantId || this.getTenantIdFromMembership(req.user);
    return await this.ticketsService.findOne(tenantId, buildingId, ticketId);
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
    const tenantId = req.user.tenantId || this.getTenantIdFromMembership(req.user);

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
    const tenantId = req.user.tenantId || this.getTenantIdFromMembership(req.user);
    return await this.ticketsService.remove(tenantId, buildingId, ticketId);
  }

  /**
   * POST /buildings/:buildingId/tickets/:ticketId/comments
   * Add a comment to a ticket
   *
   * Body: AddTicketCommentDto
   * Returns: Comment with author details
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
    const tenantId = req.user.tenantId || this.getTenantIdFromMembership(req.user);
    return await this.ticketsService.addComment(
      tenantId,
      buildingId,
      ticketId,
      req.user.id,
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
    const tenantId = req.user.tenantId || this.getTenantIdFromMembership(req.user);
    return await this.ticketsService.getComments(tenantId, buildingId, ticketId);
  }

  /**
   * Helper: Extract tenantId from user's memberships
   * Uses first available membership's tenantId
   */
  private getTenantIdFromMembership(user: any): string {
    if (!user?.memberships || user.memberships.length === 0) {
      throw new BadRequestException('No tenant context found in user memberships');
    }
    return user.memberships[0].tenantId;
  }
}
