import { BadRequestException } from '@nestjs/common';
import { Permission } from '../../../rbac/permissions';
import { IntentDefinition, IntentExecutionResult } from '../intent.types';
import {
  aggregateReportBuckets,
  bigintToSafeMonetaryNumber,
} from '../../../finanzas/currency-buckets';

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

    const [units, openTicketsCount, totalTicketsCount, outstandingGroups] = await Promise.all([
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
      // Return only final outstanding totals grouped by stored charge currency.
      prisma.$queryRaw<Array<{ currency: string; outstanding: bigint }>>`
        WITH charge_balances AS (
          SELECT
            charge.id,
            charge.currency,
            GREATEST(
              charge.amount - COALESCE(
                SUM(
                  CASE
                    WHEN payment.status IN ('APPROVED', 'RECONCILED')
                      AND payment."canceledAt" IS NULL
                      THEN allocation.amount
                    ELSE 0
                  END
                ),
                0
              ),
              0
            ) AS outstanding
          FROM "Charge" AS charge
          LEFT JOIN "PaymentAllocation" AS allocation
            ON allocation."chargeId" = charge.id
            AND allocation."tenantId" = ${tenantId}
          LEFT JOIN "Payment" AS payment
            ON payment.id = allocation."paymentId"
            AND payment."tenantId" = ${tenantId}
          WHERE charge."tenantId" = ${tenantId}
            AND charge."buildingId" = ${buildingId}
            AND charge."canceledAt" IS NULL
            AND charge.status IN ('PENDING', 'PARTIAL')
          GROUP BY charge.id, charge.currency, charge.amount
        )
        SELECT currency, SUM(outstanding) AS outstanding
        FROM charge_balances
        WHERE outstanding > 0
        GROUP BY currency
      `,
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
      outstandingGroups.map((group) => ({
        currency: group.currency,
        amountMinor: bigintToSafeMonetaryNumber(group.outstanding),
      })),
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
