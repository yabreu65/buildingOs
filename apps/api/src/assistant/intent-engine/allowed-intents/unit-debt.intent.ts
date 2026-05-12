import { BadRequestException } from '@nestjs/common';
import { ChargeStatus } from '@prisma/client';
import { Permission } from '../../../rbac/permissions';
import { IntentDefinition, IntentExecutionResult } from '../intent.types';

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
    };

    // Filter by period if provided (YYYY-MM format)
    if (filters?.period) {
      whereClause.period = filters.period;
    }

    const charges = await prisma.charge.findMany({
      where: whereClause,
      include: { paymentAllocations: { where: { payment: { status: 'APPROVED' } } } },
    });

    const chargesWithDebt = charges.map((charge) => {
      const paidAmount = charge.paymentAllocations.reduce((sum, pa) => sum + pa.amount, 0);
      const remainingDebt = charge.amount - paidAmount;
      return { ...charge, remainingDebt };
    });

    const totalDebt = chargesWithDebt.reduce((sum, c) => sum + c.remainingDebt, 0);

    return {
      data: {
        totalDebt,
        currency: 'VES',
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
