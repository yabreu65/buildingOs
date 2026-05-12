import { BadRequestException } from '@nestjs/common';
import { Permission } from '../../../rbac/permissions';
import { IntentDefinition, IntentExecutionResult } from '../intent.types';

export const unitTicketsIntent: IntentDefinition = {
  name: 'unit_tickets',
  requiredPermission: 'tickets.read' as Permission,
  supportedFilters: ['status', 'minAgeDays', 'limit', 'sortField', 'sortOrder'],
  supportedResponseTypes: ['table', 'text'],
  executor: async (params): Promise<IntentExecutionResult> => {
    const { tenantId, entityIds, filters, pagination, prisma } = params;
    const unitId = entityIds?.unitId;

    if (!unitId) {
      throw new BadRequestException('unitId required for unit_tickets intent');
    }

    const whereClause: Record<string, unknown> = {
      unitId,
      tenantId,
    };

    if (filters?.status) {
      whereClause.status = filters.status;
    }

    if (filters?.minAgeDays) {
      const minDate = new Date();
      minDate.setDate(minDate.getDate() - filters.minAgeDays);
      whereClause.createdAt = { gte: minDate };
    }

    const orderBy: Record<string, 'asc' | 'desc'> = {};
    if (filters?.sortField) {
      orderBy[filters.sortField] = filters?.sortOrder === 'desc' ? 'desc' : 'asc';
    } else {
      orderBy.createdAt = 'desc';
    }

    const tickets = await prisma.ticket.findMany({
      where: whereClause,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        category: true,
        createdAt: true,
      },
      take: pagination?.limit || 50,
      orderBy,
    });

    return {
      data: tickets.map((ticket) => ({
        title: ticket.title,
        status: ticket.status,
        priority: ticket.priority,
        createdAt: ticket.createdAt,
      })),
    };
  },
};
