import { BadRequestException } from '@nestjs/common';
import { ChargeStatus, Prisma } from '@prisma/client';
import { Permission } from '../../../rbac/permissions';
import { AssistantDebtCalculatorService } from '../../assistant-debt-calculator.service';
import { aggregateReportBuckets } from '../../../finanzas/currency-buckets';
import { PeriodResolverService } from '../../period-resolver.service';
import type { CanonicalFinancePeriod } from '../../finance-period.types';
import { IntentDefinition, IntentExecutionResult } from '../intent.types';

const debtCalculator = new AssistantDebtCalculatorService();
const periodResolver = new PeriodResolverService();

export function buildChargePeriodFilter(
  period: string | CanonicalFinancePeriod | undefined,
  referenceDate: Date = new Date(),
): Prisma.ChargeWhereInput['period'] | undefined {
  if (!period) {
    return undefined;
  }

  if (typeof period === 'string') {
    return period === 'accumulated' ? undefined : period;
  }

  if (period.kind === 'accumulated') {
    return undefined;
  }

  if (period.kind === 'relative_range' && period.mode === 'unknown') {
    throw new BadRequestException('period.mode required for relative_range building_debt queries');
  }

  const resolved = periodResolver.resolve(period, referenceDate);
  if (resolved.kind === 'unknown' || resolved.periods.length === 0) {
    return undefined;
  }

  return resolved.periods.length === 1
    ? resolved.periods[0]
    : { in: resolved.periods };
}

export const buildingDebtIntent: IntentDefinition = {
  name: 'building_debt',
  requiredPermission: 'payments.review' as Permission,
  supportedFilters: ['period'],
  supportedResponseTypes: ['kpi', 'text'],
  executor: async (params): Promise<IntentExecutionResult> => {
    const { tenantId, entityIds, filters, pagination, prisma } = params;
    const buildingId = entityIds?.buildingId;

    if (!buildingId) {
      throw new BadRequestException('buildingId required for building_debt intent');
    }

    const whereClause: Record<string, unknown> = {
      buildingId,
      tenantId,
      status: { in: [ChargeStatus.PENDING, ChargeStatus.PARTIAL] },
      canceledAt: null,
    };

    const periodFilter = buildChargePeriodFilter(filters?.period);
    if (periodFilter !== undefined) {
      whereClause.period = periodFilter;
    }

    const [tenant, charges] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { currency: true },
      }),
      prisma.charge.findMany({
        where: whereClause,
        include: {
          unit: { select: { code: true, label: true } },
          paymentAllocations: {
            include: {
              payment: {
                select: {
                  status: true,
                },
              },
            },
          },
        },
      }),
    ]);

    // Group by unit with per-currency buckets. Ordering is NON-monetary:
    // earliest overdue dueDate ASC, then unitId ASC (3F rule) — amounts in
    // different currencies are never compared or summed.
    const unitDebts: Record<
      string,
      {
        unitCode: string;
        label: string;
        earliestDue: Date;
        entries: Array<{ currency: string; amountMinor: number }>;
      }
    > = {};

    for (const charge of charges) {
      const unitKey = charge.unitId;
      const remainingDebt = debtCalculator.calculateChargeOutstanding(charge);
      if (remainingDebt <= 0) continue;

      if (!unitDebts[unitKey]) {
        unitDebts[unitKey] = {
          unitCode: charge.unit.code,
          label: charge.unit.label || charge.unit.code,
          earliestDue: charge.dueDate,
          entries: [],
        };
      }

      unitDebts[unitKey].entries.push({ currency: charge.currency, amountMinor: remainingDebt });
      if (charge.dueDate < unitDebts[unitKey].earliestDue) {
        unitDebts[unitKey].earliestDue = charge.dueDate;
      }
    }

    const outstandingByCurrency = debtCalculator.calculateOutstandingByCurrency(charges);

    return {
      data: {
        outstandingByCurrency,
        totalUnits: Object.keys(unitDebts).length,
        byUnit: Object.values(unitDebts)
          .sort((a, b) => {
            const dueDiff = a.earliestDue.getTime() - b.earliestDue.getTime();
            if (dueDiff !== 0) return dueDiff;
            return a.label.localeCompare(b.label);
          })
          .slice(0, pagination?.limit || 20)
          .map((u) => ({
            unitCode: u.unitCode,
            label: u.label,
            remainingDebtByCurrency: aggregateReportBuckets(u.entries),
          })),
      },
    };
  },
};
