import { BadRequestException } from '@nestjs/common';
import { ChargeStatus } from '@prisma/client';
import { Permission } from '../../../rbac/permissions';
import { AssistantDebtCalculatorService } from '../../assistant-debt-calculator.service';
import { IntentDefinition, IntentExecutionResult } from '../intent.types';

const debtCalculator = new AssistantDebtCalculatorService();

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
