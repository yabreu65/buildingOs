import { BadRequestException } from '@nestjs/common';
import { ChargeStatus } from '@prisma/client';
import { Permission } from '../../../rbac/permissions';
import { IntentDefinition, IntentExecutionResult } from '../intent.types';
import { aggregateReportBuckets } from '../../../finanzas/currency-buckets';
import { calculateChargeOutstandingMinor } from '../../../finanzas/charge-aggregation';

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

    const [units, openTicketsCount, totalTicketsCount, charges] = await Promise.all([
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
      // Total debt by stored charge currency, using canonical outstanding:
      // charge amount minus effective non-canceled allocations, clamped at zero.
      prisma.charge.findMany({
        where: {
          buildingId,
          tenantId,
          canceledAt: null,
          status: { not: ChargeStatus.CANCELED },
        },
        select: {
          amount: true,
          currency: true,
          paymentAllocations: {
            select: {
              amount: true,
              payment: { select: { status: true, canceledAt: true } },
            },
          },
        },
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

    const totalDebtByCurrency = aggregateReportBuckets(
      charges
        .map((charge) => ({
          currency: charge.currency,
          amountMinor: calculateChargeOutstandingMinor(charge),
        }))
        .filter((bucket) => bucket.amountMinor > 0),
    );
    const averageDebtByCurrency = totalDebtByCurrency.map((bucket) => ({
      currency: bucket.currency,
      amountMinor: totalUnits > 0 ? Math.round(bucket.amountMinor / totalUnits) : 0,
    }));

    return {
      data: {
        totalUnits,
        billableUnits,
        unitTypeCounts,
        occupancyCounts,
        openTickets: openTicketsCount,
        totalTickets: totalTicketsCount,
        totalDebtByCurrency,
        averageDebtByCurrency,
      },
    };
  },
};
