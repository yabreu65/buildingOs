import { BadRequestException } from '@nestjs/common';
import { ChargeStatus } from '@prisma/client';
import { Permission } from '../../../rbac/permissions';
import { IntentDefinition, IntentExecutionResult } from '../intent.types';

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
    };

    if (filters?.period) {
      whereClause.period = filters.period;
    }

    const charges = await prisma.charge.findMany({
      where: whereClause,
      include: {
        unit: { select: { code: true, label: true } },
        paymentAllocations: { where: { payment: { status: 'APPROVED' } } },
      },
    });

    // Group by unit and sum amounts
    const unitDebts: Record<string, { unitCode: string; label: string; totalAmount: number; paidAmount: number; remainingDebt: number }> = {};

    for (const charge of charges) {
      const unitKey = charge.unitId;
      const paidAmount = charge.paymentAllocations.reduce((sum, pa) => sum + pa.amount, 0);
      const remainingDebt = charge.amount - paidAmount;

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

    const totalDebt = Object.values(unitDebts).reduce((sum, u) => sum + u.remainingDebt, 0);

    return {
      data: {
        totalDebt,
        currency: 'VES',
        totalUnits: Object.keys(unitDebts).length,
        byUnit: Object.values(unitDebts).sort((a, b) => b.remainingDebt - a.remainingDebt).slice(0, pagination?.limit || 20),
      },
    };
  },
};
