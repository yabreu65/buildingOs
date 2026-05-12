import { BadRequestException } from '@nestjs/common';
import { Permission } from '../../../rbac/permissions';
import { IntentDefinition, IntentExecutionResult } from '../intent.types';

export const buildingStatsIntent: IntentDefinition = {
  name: 'building_stats',
  requiredPermission: 'buildings.read' as Permission,
  supportedFilters: ['period'],
  supportedResponseTypes: ['kpi', 'text', 'chart'],
  executor: async (params): Promise<IntentExecutionResult> => {
    const { tenantId, entityIds, filters, pagination, prisma } = params;
    const buildingId = entityIds?.buildingId;

    if (!buildingId) {
      throw new BadRequestException('buildingId required for building_stats intent');
    }

    const [units, openTicketsCount, totalTicketsCount, totalDebt] = await Promise.all([
      // Unit counts by type and occupancy
      prisma.unit.groupBy({
        by: ['unitType', 'occupancyStatus'],
        where: { buildingId, tenantId },
        _count: { unitType: true },
      }),
      // Open tickets count
      prisma.ticket.count({
        where: { buildingId, tenantId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      }),
      // Total tickets count
      prisma.ticket.count({
        where: { buildingId, tenantId },
      }),
      // Total debt
      prisma.charge.aggregate({
        where: { buildingId, tenantId, status: { in: ['PENDING', 'PARTIAL'] } },
        _sum: { amount: true },
      }),
    ]);

    // Process unit counts
    const unitTypeCounts: Record<string, number> = {};
    const occupancyCounts: Record<string, number> = {};
    let totalUnits = 0;
    let billableUnits = 0;

    for (const group of units) {
      totalUnits += group._count.unitType;
      unitTypeCounts[group.unitType] = (unitTypeCounts[group.unitType] || 0) + group._count.unitType;
      occupancyCounts[group.occupancyStatus] = (occupancyCounts[group.occupancyStatus] || 0) + group._count.unitType;
    }

    // Get billable units count
    const billableCount = await prisma.unit.count({
      where: { buildingId, tenantId, isBillable: true },
    });
    billableUnits = billableCount;

    const averageDebt = totalUnits > 0 ? Number(totalDebt._sum.amount || 0) / totalUnits : 0;

    return {
      data: {
        totalUnits,
        billableUnits,
        unitTypeCounts,
        occupancyCounts,
        openTickets: openTicketsCount,
        totalTickets: totalTicketsCount,
        totalDebt: Number(totalDebt._sum.amount || 0),
        averageDebt,
        currency: 'VES',
      },
    };
  },
};
