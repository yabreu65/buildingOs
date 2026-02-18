import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupportTicketStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { UpdateSupportTicketDto, AddSupportTicketCommentDto, AssignSupportTicketDto } from './dto/update-support-ticket.dto';

@Injectable()
export class SupportTicketsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  /**
   * Create a new support ticket
   */
  async create(
    tenantId: string,
    userId: string,
    dto: CreateSupportTicketDto,
  ) {
    const ticket = await this.prisma.supportTicket.create({
      data: {
        tenantId,
        createdByUserId: userId,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        priority: dto.priority,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });

    // Audit log
    await this.auditService.createLog({
      tenantId,
      action: 'SUPPORT_TICKET_CREATE',
      entityType: 'SupportTicket',
      entityId: ticket.id,
      actorUserId: userId,
      metadata: {
        title: ticket.title,
        category: ticket.category,
        priority: ticket.priority,
      },
    });

    return ticket;
  }

  /**
   * Get all support tickets visible to the user
   * SUPER_ADMIN: sees all
   * TENANT_ADMIN: sees only their tenant's tickets
   */
  async findAll(
    tenantId: string | null,
    userId: string,
    userRoles: string[],
    skip: number = 0,
    take: number = 50,
    filters?: { status?: string; category?: string; priority?: string },
  ) {
    // Build query
    const where: any = {};

    // SUPER_ADMIN sees all, TENANT_ADMIN sees only their tenant's
    if (!userRoles.includes('SUPER_ADMIN')) {
      if (!tenantId) {
        throw new BadRequestException('Tenant ID required');
      }
      where.tenantId = tenantId;
    }

    // Apply filters
    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.category) {
      where.category = filters.category;
    }
    if (filters?.priority) {
      where.priority = filters.priority;
    }

    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          assignedTo: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return { tickets, total };
  }

  /**
   * Get a single support ticket by ID
   */
  async findOne(
    ticketId: string,
    tenantId: string | null,
    userRoles: string[],
  ) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        comments: {
          include: {
            author: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Support ticket not found');
    }

    // Access control: SUPER_ADMIN sees all, others see only their tenant's
    if (!userRoles.includes('SUPER_ADMIN') && ticket.tenantId !== tenantId) {
      throw new NotFoundException('Support ticket not found');
    }

    return ticket;
  }

  /**
   * Update support ticket (title, description, priority)
   */
  async update(
    ticketId: string,
    tenantId: string | null,
    userId: string,
    userRoles: string[],
    dto: UpdateSupportTicketDto,
  ) {
    const ticket = await this.findOne(ticketId, tenantId, userRoles);

    // Can only update own tickets or if SUPER_ADMIN
    if (!userRoles.includes('SUPER_ADMIN') && ticket.createdByUserId !== userId) {
      throw new ForbiddenException('Can only update your own tickets');
    }

    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        title: dto.title ?? ticket.title,
        description: dto.description ?? ticket.description,
        priority: dto.priority ?? ticket.priority,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });

    // Audit log
    await this.auditService.createLog({
      tenantId: ticket.tenantId,
      action: 'SUPPORT_TICKET_UPDATE',
      entityType: 'SupportTicket',
      entityId: ticketId,
      actorUserId: userId,
      metadata: {
        before: { title: ticket.title, priority: ticket.priority },
        after: { title: updated.title, priority: updated.priority },
      },
    });

    return updated;
  }

  /**
   * Change ticket status (OPEN → IN_PROGRESS → RESOLVED → CLOSED)
   */
  async updateStatus(
    ticketId: string,
    tenantId: string | null,
    userId: string,
    userRoles: string[],
    newStatus: SupportTicketStatus,
  ) {
    const ticket = await this.findOne(ticketId, tenantId, userRoles);

    // Only SUPER_ADMIN can change status
    if (!userRoles.includes('SUPER_ADMIN')) {
      throw new ForbiddenException('Only super admin can change ticket status');
    }

    // State machine: validate transitions
    const validTransitions: Record<SupportTicketStatus, SupportTicketStatus[]> = {
      OPEN: ['IN_PROGRESS', 'CLOSED'],
      IN_PROGRESS: ['RESOLVED', 'CLOSED'],
      RESOLVED: ['CLOSED'],
      CLOSED: [],
    };

    if (!validTransitions[ticket.status]?.includes(newStatus)) {
      throw new BadRequestException(
        `Cannot transition from ${ticket.status} to ${newStatus}`,
      );
    }

    const resolvedAt = newStatus === 'RESOLVED' ? new Date() : ticket.resolvedAt;
    const closedAt = newStatus === 'CLOSED' ? new Date() : ticket.closedAt;

    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: newStatus,
        resolvedAt,
        closedAt,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });

    // Audit log
    await this.auditService.createLog({
      tenantId: ticket.tenantId,
      action: 'SUPPORT_TICKET_STATUS_CHANGE',
      entityType: 'SupportTicket',
      entityId: ticketId,
      actorUserId: userId,
      metadata: {
        from: ticket.status,
        to: newStatus,
      },
    });

    return updated;
  }

  /**
   * Assign ticket to a user (SUPER_ADMIN only)
   */
  async assign(
    ticketId: string,
    tenantId: string | null,
    userId: string,
    userRoles: string[],
    dto: AssignSupportTicketDto,
  ) {
    const ticket = await this.findOne(ticketId, tenantId, userRoles);

    // Only SUPER_ADMIN can assign
    if (!userRoles.includes('SUPER_ADMIN')) {
      throw new ForbiddenException('Only super admin can assign tickets');
    }

    // Verify assignee exists if provided
    if (dto.assignedToUserId) {
      const assignee = await this.prisma.user.findUnique({
        where: { id: dto.assignedToUserId },
      });
      if (!assignee) {
        throw new NotFoundException('User not found');
      }
    }

    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { assignedToUserId: dto.assignedToUserId || null },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });

    // Audit log
    await this.auditService.createLog({
      tenantId: ticket.tenantId,
      action: 'SUPPORT_TICKET_ASSIGN',
      entityType: 'SupportTicket',
      entityId: ticketId,
      actorUserId: userId,
      metadata: {
        assignedTo: dto.assignedToUserId,
      },
    });

    return updated;
  }

  /**
   * Add comment to support ticket
   */
  async addComment(
    ticketId: string,
    tenantId: string | null,
    userId: string,
    userRoles: string[],
    dto: AddSupportTicketCommentDto,
  ) {
    const ticket = await this.findOne(ticketId, tenantId, userRoles);

    const comment = await this.prisma.supportTicketComment.create({
      data: {
        supportTicketId: ticketId,
        authorUserId: userId,
        body: dto.body,
      },
      include: {
        author: { select: { id: true, name: true, email: true } },
      },
    });

    // Audit log
    await this.auditService.createLog({
      tenantId: ticket.tenantId,
      action: 'SUPPORT_TICKET_COMMENT_ADD',
      entityType: 'SupportTicketComment',
      entityId: comment.id,
      actorUserId: userId,
      metadata: {
        ticketId,
        body: dto.body.substring(0, 100), // First 100 chars
      },
    });

    return comment;
  }

  /**
   * Delete/close support ticket (SUPER_ADMIN only)
   */
  async close(
    ticketId: string,
    tenantId: string | null,
    userId: string,
    userRoles: string[],
  ) {
    const ticket = await this.findOne(ticketId, tenantId, userRoles);

    // Only SUPER_ADMIN can close
    if (!userRoles.includes('SUPER_ADMIN')) {
      throw new ForbiddenException('Only super admin can close tickets');
    }

    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });

    // Audit log
    await this.auditService.createLog({
      tenantId: ticket.tenantId,
      action: 'SUPPORT_TICKET_CLOSE',
      entityType: 'SupportTicket',
      entityId: ticketId,
      actorUserId: userId,
    });

    return updated;
  }
}
