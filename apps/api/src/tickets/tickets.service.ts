import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Ticket, TicketComment, Prisma, AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TicketsValidators } from './tickets.validators';
import { TicketStateMachine } from './tickets.state-machine';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { AddTicketCommentDto } from './dto/add-ticket-comment.dto';
import { AiTicketCategoryService } from '../assistant/ai-ticket-category.service';

/**
 * TicketsService: CRUD operations for Tickets with scope validation
 *
 * All methods validate that resources belong to the tenant/building.
 * No cross-tenant/building access is possible, even with guessed IDs.
 */
interface TicketFilters {
  status?: string;
  priority?: string;
  unitId?: string;
  assignedToMembershipId?: string;
  limit?: number;
  page?: number;
  search?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'priority' | 'status';
  sortOrder?: 'asc' | 'desc';
}

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly validators: TicketsValidators,
    private readonly auditService: AuditService,
    private readonly aiCategoryService: AiTicketCategoryService,
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
    // Find the TenantMember for this user in this tenant
    const member = await this.prisma.tenantMember.findFirst({
      where: {
        tenantId,
        userId,
      },
      select: { id: true },
    });

    if (!member) {
      return [];
    }

    // Find all UnitOccupants for this member
    const occupancies = await this.prisma.unitOccupant.findMany({
      where: {
        memberId: member.id,
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

    // 4. Create ticket (with default category if not provided)
    const ticket = await this.prisma.ticket.create({
      data: {
        tenantId,
        buildingId,
        unitId: dto.unitId,
        createdByUserId: userId,
        assignedToMembershipId: dto.assignedToMembershipId,
        title: dto.title,
        description: dto.description,
        category: dto.category || 'OTHER', // Default to OTHER if not provided
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

    // Audit: TICKET_CREATE
    void this.auditService.createLog({
      tenantId,
      actorUserId: userId,
      action: AuditAction.TICKET_CREATE,
      entityType: 'Ticket',
      entityId: ticket.id,
      metadata: {
        title: ticket.title,
        buildingId,
        unitId: ticket.unitId,
      },
    });

    // FASE 2: Fire-and-forget AI categorization (never blocks user response)
    // Only run if user didn't explicitly provide category/priority
    if (!dto.category || !dto.priority) {
      void this.runAiCategorization(tenantId, ticket.id, dto.title, dto.description, buildingId, dto.unitId);
    }

    return ticket;
  }

  /**
   * Run AI categorization in background (fire-and-forget)
   * Never fails the main operation, never blocks ticket creation
   */
  private async runAiCategorization(
    tenantId: string,
    ticketId: string,
    title: string,
    description: string,
    buildingId?: string,
    unitId?: string,
  ): Promise<void> {
    try {
      const suggestion = await this.aiCategoryService.suggestCategory(
        tenantId,
        title,
        description,
        buildingId,
        unitId,
      );

      if (!suggestion) {
        this.logger.debug(`[AI Categorization] No suggestion for ticket ${ticketId}`);
        return;
      }

      // Update ticket with AI suggestion
      await this.prisma.ticket.update({
        where: { id: ticketId },
        data: {
          category: suggestion.category,
          priority: suggestion.priority,
          aiSuggestedCategory: true,
          aiCategorySuggestion: JSON.stringify({
            category: suggestion.category,
            priority: suggestion.priority,
            confidence: suggestion.confidence,
            reasoning: suggestion.reasoning,
          }),
        },
      });

      this.logger.debug(
        `[AI Categorization] Updated ticket ${ticketId}: category=${suggestion.category}, priority=${suggestion.priority}`,
      );
    } catch (error) {
      // Fire-and-forget: log but never fail
      this.logger.error(
        `[AI Categorization] Failed for ticket ${ticketId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get all tickets in a building
   *
   * @throws NotFoundException if building doesn't belong to tenant
   */
  async findAll(tenantId: string, buildingId: string, filters?: TicketFilters): Promise<Ticket[]> {
    // 1. Validate building
    await this.validators.validateBuildingBelongsToTenant(
      tenantId,
      buildingId,
    );

    // 2. Build query
    const where: Prisma.TicketWhereInput = { tenantId, buildingId };
    
    // Handle multiple status values (comma-separated: "OPEN,IN_PROGRESS")
    if (filters?.status) {
      const validStatuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
      const statusValues = filters.status.split(',').filter(s => validStatuses.includes(s));
      
      if (statusValues.length === 1) {
        where.status = statusValues[0] as any;
      } else if (statusValues.length > 1) {
        where.status = { in: statusValues } as any;
      }
    }
    if (filters?.priority) where.priority = filters.priority as any;
    if (filters?.unitId) where.unitId = filters.unitId;
    if (filters?.assignedToMembershipId)
      where.assignedToMembershipId = filters.assignedToMembershipId;

    // Search by title or description
    if (filters?.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    // 3. Pagination (default: 10 per page)
    const pageSize = Math.min(filters?.limit || 10, 100);
    const currentPage = filters?.page || 1;
    const skip = (currentPage - 1) * pageSize;

    // 4. Sorting
    const sortBy = filters?.sortBy || 'createdAt';
    const sortOrder = filters?.sortOrder || 'desc';
    const orderBy: any = {};
    orderBy[sortBy] = sortOrder;

    // 5. Diagnostic logging
    const startTime = Date.now();
    this.logger.debug(
      `[findAll] tenantId=${tenantId}, buildingId=${buildingId}, search=${filters?.search || 'none'}, page=${currentPage}, pageSize=${pageSize}, sortBy=${sortBy}, sortOrder=${sortOrder}`,
    );

    try {
      const [tickets, total] = await Promise.all([
        this.prisma.ticket.findMany({
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
          orderBy,
          take: pageSize,
          skip,
        }),
        this.prisma.ticket.count({ where }),
      ]);

      const duration = Date.now() - startTime;
      this.logger.debug(
        `[findAll] Found ${tickets.length} of ${total} tickets in ${duration}ms`,
      );

      return {
        tickets: tickets as any,
        total,
        page: currentPage,
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `[findAll] Error after ${duration}ms: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
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
  async findOne(tenantId: string, buildingId: string, ticketId: string): Promise<Ticket & { comments: unknown[] }> {
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
  ): Promise<Ticket> {
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
    const data: Prisma.TicketUpdateInput = {};
    if (dto.title) data.title = dto.title;
    if (dto.description) data.description = dto.description;
    if (dto.category) data.category = dto.category as Prisma.EnumTicketCategoryFieldUpdateOperationsInput;
    if (dto.priority) data.priority = dto.priority as Prisma.EnumTicketPriorityFieldUpdateOperationsInput;
    if (dto.status) {
      data.status = dto.status as Prisma.EnumTicketStatusFieldUpdateOperationsInput;
      // Set closedAt when transitioning to CLOSED
      if (dto.status === 'CLOSED' && currentTicket.status !== 'CLOSED') {
        data.closedAt = new Date();
      }
      // Clear closedAt when reopening
      if (TicketStateMachine.isReopening(currentTicket.status, dto.status)) {
        data.closedAt = null;
      }
    }
    if (dto.unitId !== undefined && dto.unitId !== null) {
      data.unit = { connect: { id: dto.unitId } };
    } else if (dto.unitId === null) {
      data.unit = { disconnect: true };
    }
    if (dto.assignedToMembershipId !== undefined) {
      if (dto.assignedToMembershipId) {
        data.assignedTo = { connect: { id: dto.assignedToMembershipId } };
      } else {
        data.assignedTo = { disconnect: true };
      }
    }

    const ticket = await this.prisma.ticket.update({
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

    // Audit: TICKET_STATUS_CHANGE (only log if status changed)
    if (dto.status && dto.status !== currentTicket.status) {
      void this.auditService.createLog({
        tenantId,
        actorUserId: currentTicket.createdByUserId, // The creator of the ticket
        action: AuditAction.TICKET_STATUS_CHANGE,
        entityType: 'Ticket',
        entityId: ticketId,
        metadata: {
          oldStatus: currentTicket.status,
          newStatus: dto.status,
        },
      });
    }

    return ticket;
  }

  /**
   * Delete a ticket (cascade deletes comments)
   *
   * @throws NotFoundException if ticket or building doesn't belong to tenant
   */
  async remove(tenantId: string, buildingId: string, ticketId: string): Promise<Ticket> {
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
  ): Promise<TicketComment> {
    // 1. Validate ticket scope
    await this.validators.validateTicketBelongsToBuildingAndTenant(
      tenantId,
      buildingId,
      ticketId,
    );

    // 2. Add comment
    const comment = await this.prisma.ticketComment.create({
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

    // Audit: TICKET_COMMENT_ADD
    void this.auditService.createLog({
      tenantId,
      actorUserId: userId,
      action: AuditAction.TICKET_COMMENT_ADD,
      entityType: 'TicketComment',
      entityId: comment.id,
      metadata: {
        ticketId,
      },
    });

    return comment;
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
  ): Promise<TicketComment[]> {
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
