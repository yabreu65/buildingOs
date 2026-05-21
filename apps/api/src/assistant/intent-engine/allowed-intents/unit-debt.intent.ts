import { BadRequestException } from '@nestjs/common';
import { ChargeStatus } from '@prisma/client';
import { Permission } from '../../../rbac/permissions';
import { AssistantDebtCalculatorService } from '../../assistant-debt-calculator.service';
import { IntentDefinition, IntentExecutionResult } from '../intent.types';

const debtCalculator = new AssistantDebtCalculatorService();

export const unitDebtIntent: IntentDefinition = {
  name: 'unit_debt',
  requiredPermission: 'payments.review' as Permission,
  supportedFilters: ['period'],
  supportedResponseTypes: ['kpi', 'text'],
  executor: async (params): Promise<IntentExecutionResult> => {
    const { tenantId, entityIds, filters, pagination, prisma } = params;
    const unitId = entityIds?.unitId;

    if (!unitId) {
      throw new BadRequestException('unitId required for unit_debt intent');
    }

    const whereClause: Record<string, unknown> = {
      unitId,
      tenantId,
      status: { in: [ChargeStatus.PENDING, ChargeStatus.PARTIAL] },
      canceledAt: null,
    };

    // Filter by period if provided (YYYY-MM format)
    if (filters?.period) {
      whereClause.period = filters.period;
    }

    const [tenant, charges] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { currency: true },
      }),
      prisma.charge.findMany({
        where: whereClause,
        include: {
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

    const chargesWithDebt = charges.map((charge) => {
      const remainingDebt = debtCalculator.calculateChargeOutstanding(charge);
      return { ...charge, remainingDebt };
    });

    const totalDebt = debtCalculator.calculateOutstanding(charges);
    const overduePeriods = Array.from(
      new Set(
        chargesWithDebt
          .filter((c) => c.remainingDebt > 0 && c.period)
          .map((c) => c.period),
      ),
    ).sort();

    return {
      data: {
        totalDebt,
        overduePeriodCount: overduePeriods.length,
        overduePeriods,
        currency: tenant.currency,
        charges: chargesWithDebt.map((c) => ({
          period: c.period,
          concept: c.concept,
          amount: c.amount,
          remainingDebt: c.remainingDebt,
          status: c.status,
          dueDate: c.dueDate,
        })),
      },
    };
  },
};
