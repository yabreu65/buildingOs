import { BadRequestException } from '@nestjs/common';
import { Permission } from '../../../rbac/permissions';
import { IntentDefinition, IntentExecutionResult } from '../intent.types';

export const buildingTicketsIntent: IntentDefinition = {
  name: 'building_tickets',
  requiredPermission: 'tickets.read' as Permission,
  supportedFilters: ['status', 'minAgeDays', 'limit', 'sortField', 'sortOrder'],
  supportedResponseTypes: ['table', 'text'],
  executor: async (params): Promise<IntentExecutionResult> => {
    const { tenantId, entityIds, filters, pagination, prisma } = params;
    const buildingId = entityIds?.buildingId;

    if (!buildingId) {
      throw new BadRequestException('buildingId required for building_tickets intent');
    }

    const whereClause: Record<string, unknown> = {
      buildingId,
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

    const [tickets, statusCounts] = await Promise.all([
      prisma.ticket.findMany({
        where: whereClause,
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          category: true,
          unitId: true,
          createdAt: true,
        },
        take: pagination?.limit || 50,
        orderBy,
      }),
      // Get status counts for summary
      prisma.ticket.groupBy({
        by: ['status'],
        where: { buildingId, tenantId },
        _count: { status: true },
      }),
    ]);

    const statusSummary: Record<string, number> = {};
    for (const group of statusCounts) {
      statusSummary[group.status] = group._count.status;
    }

    return {
      data: {
        tickets: tickets.map((t) => ({
          title: t.title,
          status: t.status,
          priority: t.priority,
          isUnitSpecific: !!t.unitId,
          createdAt: t.createdAt,
        })),
        statusSummary,
        total: tickets.length,
      },
    };
  },
};
