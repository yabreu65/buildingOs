import { BadRequestException } from '@nestjs/common';
import { ChargeStatus, Prisma } from '@prisma/client';
import { Permission } from '../../../rbac/permissions';
import { AssistantDebtCalculatorService } from '../../assistant-debt-calculator.service';
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

    // Group by unit and sum amounts
    const unitDebts: Record<string, { unitCode: string; label: string; totalAmount: number; paidAmount: number; remainingDebt: number }> = {};

    for (const charge of charges) {
      const unitKey = charge.unitId;
      const remainingDebt = debtCalculator.calculateChargeOutstanding(charge);
      const paidAmount = Math.max(0, charge.amount - remainingDebt);

      if (!unitDebts[unitKey]) {
        unitDebts[unitKey] = {
          unitCode: charge.unit.code,
          label: charge.unit.label || charge.unit.code,
          totalAmount: 0,
          paidAmount: 0,
          remainingDebt: 0,
        };
      }

      unitDebts[unitKey].totalAmount += charge.amount;
      unitDebts[unitKey].paidAmount += paidAmount;
      unitDebts[unitKey].remainingDebt += remainingDebt;
    }

    const totalDebt = debtCalculator.calculateOutstanding(charges);

    return {
      data: {
        totalDebt,
        currency: tenant.currency,
        totalUnits: Object.keys(unitDebts).length,
        byUnit: Object.values(unitDebts).sort((a, b) => b.remainingDebt - a.remainingDebt).slice(0, pagination?.limit || 20),
      },
    };
  },
};
