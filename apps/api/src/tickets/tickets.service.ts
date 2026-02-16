import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsValidators } from './tickets.validators';
import { TicketStateMachine } from './tickets.state-machine';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { AddTicketCommentDto } from './dto/add-ticket-comment.dto';

/**
 * TicketsService: CRUD operations for Tickets with scope validation
 *
 * All methods validate that resources belong to the tenant/building.
 * No cross-tenant/building access is possible, even with guessed IDs.
 */
@Injectable()
export class TicketsService {
  constructor(
    private prisma: PrismaService,
    private validators: TicketsValidators,
  ) {}

  /**
   * Get all unit IDs where a user has active UnitOccupant role (RESIDENT or OWNER)
   * Used for RESIDENT scope validation
   *
   * @param tenantId - Tenant context
   * @param userId - User to check
   * @returns Array of unit IDs where user is an occupant
   */
  async getUserUnitIds(tenantId: string, userId: string): Promise<string[]> {
    const occupancies = await this.prisma.unitOccupant.findMany({
      where: {
        userId,
        unit: {
          building: { tenantId }, // Ensure unit belongs to tenant
        },
      },
      select: { unitId: true },
      distinct: ['unitId'], // Get unique unit IDs
    });

    return occupancies.map((o) => o.unitId);
  }

  /**
   * Validate that a RESIDENT user has access to a specific unit
   * Returns 404 if unit not found in user's accessible units
   *
   * @param tenantId - Tenant context
   * @param userId - User to validate
   * @param unitId - Unit to access
   * @throws NotFoundException if user doesn't have access
   */
  async validateResidentUnitAccess(
    tenantId: string,
    userId: string,
    unitId: string,
  ): Promise<void> {
    const userUnitIds = await this.getUserUnitIds(tenantId, userId);
    if (!userUnitIds.includes(unitId)) {
      throw new NotFoundException(
        `Unit not found or does not belong to you`,
      );
    }
  }

  /**
   * Create a ticket in a building
   *
   * Validates:
   * - Building belongs to tenant
   * - Unit (if provided) belongs to building and tenant
   *
   * @throws NotFoundException if building/unit doesn't belong to tenant
   */
  async create(
    tenantId: string,
    buildingId: string,
    userId: string,
    dto: CreateTicketDto,
  ) {
    // 1. Validate building belongs to tenant
    await this.validators.validateBuildingBelongsToTenant(
      tenantId,
      buildingId,
    );

    // 2. Validate unit if provided
    if (dto.unitId) {
      await this.validators.validateUnitBelongsToBuildingAndTenant(
        tenantId,
        buildingId,
        dto.unitId,
      );
    }

    // 3. Validate assignedToMembershipId if provided
    if (dto.assignedToMembershipId) {
      const membership = await this.prisma.membership.findFirst({
        where: {
          id: dto.assignedToMembershipId,
          tenantId,
        },
      });

      if (!membership) {
        throw new BadRequestException(
          `Membership not found or does not belong to this tenant`,
        );
      }
    }

    // 4. Create ticket
    return await this.prisma.ticket.create({
      data: {
        tenantId,
        buildingId,
        unitId: dto.unitId,
        createdByUserId: userId,
        assignedToMembershipId: dto.assignedToMembershipId,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        priority: dto.priority || 'MEDIUM',
        status: 'OPEN',
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        assignedTo: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        building: { select: { id: true, name: true } },
        unit: { select: { id: true, label: true, code: true } },
        comments: { include: { author: { select: { id: true, name: true } } } },
      },
    });
  }

  /**
   * Get all tickets in a building
   *
   * @throws NotFoundException if building doesn't belong to tenant
   */
  async findAll(tenantId: string, buildingId: string, filters?: any) {
    // 1. Validate building
    await this.validators.validateBuildingBelongsToTenant(
      tenantId,
      buildingId,
    );

    // 2. Build query
    const where: any = { tenantId, buildingId };
    if (filters?.status) where.status = filters.status;
    if (filters?.priority) where.priority = filters.priority;
    if (filters?.assignedToMembershipId)
      where.assignedToMembershipId = filters.assignedToMembershipId;

    return await this.prisma.ticket.findMany({
      where,
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        assignedTo: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        building: { select: { id: true, name: true } },
        unit: { select: { id: true, label: true, code: true } },
        comments: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          include: { author: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a single ticket
   *
   * Validates:
   * - Building belongs to tenant
   * - Ticket belongs to building and tenant
   *
   * @throws NotFoundException if ticket or building doesn't belong to tenant
   */
  async findOne(tenantId: string, buildingId: string, ticketId: string) {
    // 1. Validate scope
    await this.validators.validateTicketScope(
      tenantId,
      buildingId,
      ticketId,
    );

    // 2. Fetch ticket with full details
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, tenantId, buildingId },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        assignedTo: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        building: { select: { id: true, name: true } },
        unit: { select: { id: true, label: true, code: true } },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { id: true, name: true, email: true } } },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException(
        `Ticket not found or does not belong to this building/tenant`,
      );
    }

    return ticket;
  }

  /**
   * Update a ticket
   *
   * Validates:
   * - Building belongs to tenant
   * - Ticket belongs to building and tenant
   * - New unit (if changed) belongs to building and tenant
   * - New assignee (if changed) belongs to tenant
   * - Status transition is valid (if status changing)
   *
   * Status transitions:
   * - OPEN → IN_PROGRESS | CLOSED
   * - IN_PROGRESS → RESOLVED | OPEN
   * - RESOLVED → CLOSED | IN_PROGRESS
   * - CLOSED → OPEN (reopen)
   *
   * @throws NotFoundException if ticket or building doesn't belong to tenant
   * @throws BadRequestException if status transition is invalid
   */
  async update(
    tenantId: string,
    buildingId: string,
    ticketId: string,
    dto: UpdateTicketDto,
  ) {
    // 1. Validate scope and fetch current ticket
    const currentTicket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, tenantId, buildingId },
    });

    if (!currentTicket) {
      throw new NotFoundException(
        `Ticket not found or does not belong to this building/tenant`,
      );
    }

    // 2. Validate status transition if changing
    if (dto.status && dto.status !== currentTicket.status) {
      TicketStateMachine.validateTransition(currentTicket.status, dto.status);
    }

    // 3. Validate new unit if provided
    if (dto.unitId !== undefined) {
      if (dto.unitId) {
        await this.validators.validateUnitBelongsToBuildingAndTenant(
          tenantId,
          buildingId,
          dto.unitId,
        );
      }
    }

    // 4. Validate new assignee if provided
    if (dto.assignedToMembershipId !== undefined) {
      if (dto.assignedToMembershipId) {
        const membership = await this.prisma.membership.findFirst({
          where: {
            id: dto.assignedToMembershipId,
            tenantId,
          },
        });

        if (!membership) {
          throw new BadRequestException(
            `Membership not found or does not belong to this tenant`,
          );
        }
      }
    }

    // 5. Build update data
    const data: any = {};
    if (dto.title) data.title = dto.title;
    if (dto.description) data.description = dto.description;
    if (dto.category) data.category = dto.category;
    if (dto.priority) data.priority = dto.priority;
    if (dto.status) {
      data.status = dto.status;
      // Set closedAt when transitioning to CLOSED
      if (dto.status === 'CLOSED' && currentTicket.status !== 'CLOSED') {
        data.closedAt = new Date();
      }
      // Clear closedAt when reopening
      if (TicketStateMachine.isReopening(currentTicket.status, dto.status)) {
        data.closedAt = null;
      }
    }
    if (dto.unitId !== undefined) data.unitId = dto.unitId;
    if (dto.assignedToMembershipId !== undefined)
      data.assignedToMembershipId = dto.assignedToMembershipId;

    return await this.prisma.ticket.update({
      where: { id: ticketId },
      data,
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        assignedTo: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        building: { select: { id: true, name: true } },
        unit: { select: { id: true, label: true, code: true } },
        comments: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { author: { select: { id: true, name: true } } },
        },
      },
    });
  }

  /**
   * Delete a ticket (cascade deletes comments)
   *
   * @throws NotFoundException if ticket or building doesn't belong to tenant
   */
  async remove(tenantId: string, buildingId: string, ticketId: string) {
    // 1. Validate scope
    await this.validators.validateTicketScope(
      tenantId,
      buildingId,
      ticketId,
    );

    // 2. Delete ticket (comments cascade)
    return await this.prisma.ticket.delete({
      where: { id: ticketId },
    });
  }

  /**
   * Add comment to ticket
   *
   * Validates:
   * - Ticket belongs to building and tenant
   *
   * @throws NotFoundException if ticket doesn't belong to tenant/building
   */
  async addComment(
    tenantId: string,
    buildingId: string,
    ticketId: string,
    userId: string,
    dto: AddTicketCommentDto,
  ) {
    // 1. Validate ticket scope
    await this.validators.validateTicketBelongsToBuildingAndTenant(
      tenantId,
      buildingId,
      ticketId,
    );

    // 2. Add comment
    return await this.prisma.ticketComment.create({
      data: {
        tenantId,
        ticketId,
        authorUserId: userId,
        body: dto.body,
      },
      include: {
        author: { select: { id: true, name: true, email: true } },
      },
    });
  }

  /**
   * Get comments for a ticket
   *
   * @throws NotFoundException if ticket doesn't belong to tenant/building
   */
  async getComments(
    tenantId: string,
    buildingId: string,
    ticketId: string,
  ) {
    // 1. Validate ticket scope
    await this.validators.validateTicketBelongsToBuildingAndTenant(
      tenantId,
      buildingId,
      ticketId,
    );

    // 2. Get comments
    return await this.prisma.ticketComment.findMany({
      where: { ticketId, tenantId },
      include: {
        author: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
