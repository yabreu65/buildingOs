import { BadRequestException } from '@nestjs/common';
import { ChargeStatus } from '@prisma/client';
import { Permission } from '../../../rbac/permissions';
import { AssistantDebtCalculatorService } from '../../assistant-debt-calculator.service';
import { IntentDefinition, IntentExecutionResult } from '../intent.types';

const debtCalculator = new AssistantDebtCalculatorService();

export const buildingDelinquentsIntent: IntentDefinition = {
  name: 'building_delinquents',
  requiredPermission: 'payments.review' as Permission,
  supportedFilters: ['minAmount', 'maxAmount', 'limit', 'sortField', 'sortOrder'],
  supportedResponseTypes: ['table', 'text'],
  executor: async (params): Promise<IntentExecutionResult> => {
    const { tenantId, entityIds, filters, pagination, prisma } = params;
    const buildingId = entityIds?.buildingId;

    if (!buildingId) {
      throw new BadRequestException('buildingId required for building_delinquents intent');
    }

    const [tenant, overdueCharges] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { currency: true },
      }),
      // Find charges with OVERDUE status grouped by unit
      prisma.charge.findMany({
      where: {
        buildingId,
        tenantId,
        status: ChargeStatus.PENDING, // PENDING includes overdue when overdueSince is set
        overdueSince: { not: null },
        canceledAt: null,
      },
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

    // Group by unit and calculate debt
    const unitDebts: Record<string, { unitCode: string; label: string; totalDebt: number }> = {};

    for (const charge of overdueCharges) {
      const unitKey = charge.unitId;
      const remainingDebt = debtCalculator.calculateChargeOutstanding(charge);

      if (remainingDebt <= 0) continue; // Skip fully paid

      if (!unitDebts[unitKey]) {
        unitDebts[unitKey] = {
          unitCode: charge.unit.code,
          label: charge.unit.label || charge.unit.code,
          totalDebt: 0,
        };
      }

      unitDebts[unitKey].totalDebt += remainingDebt;
    }

    const delinquents = Object.values(unitDebts)
      .filter((u) => u.totalDebt > 0)
      .sort((a, b) => b.totalDebt - a.totalDebt)
      .filter((u) => {
        const minDebt = typeof filters?.minDebt === 'number' ? filters.minDebt : filters?.minAmount;
        const maxDebt = filters?.maxAmount;
        if (typeof minDebt === 'number' && u.totalDebt < minDebt) return false;
        if (typeof maxDebt === 'number' && u.totalDebt > maxDebt) return false;
        return true;
      })
      .slice(0, pagination?.limit || 20);

    return {
      data: {
        delinquents,
        totalUnitsWithDebt: delinquents.length,
        currency: tenant.currency,
      },
    };
  },
};
