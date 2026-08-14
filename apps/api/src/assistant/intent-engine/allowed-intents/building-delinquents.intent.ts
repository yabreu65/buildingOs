import { BadRequestException } from '@nestjs/common';
import { ChargeStatus } from '@prisma/client';
import { Permission } from '../../../rbac/permissions';
import { AssistantDebtCalculatorService } from '../../assistant-debt-calculator.service';
import { aggregateReportBuckets } from '../../../finanzas/currency-buckets';
import { IntentDefinition, IntentExecutionResult, IntentFilters } from '../intent.types';

const debtCalculator = new AssistantDebtCalculatorService();

interface MonetaryOperation {
  readonly minAmount?: number;
  readonly maxAmount?: number;
  readonly sortByAmount?: boolean;
}

function hasMonetaryOperation(filters: IntentFilters | undefined): MonetaryOperation {
  const minAmount = typeof filters?.minAmount === 'number' ? filters.minAmount : undefined;
  const maxAmount = typeof filters?.maxAmount === 'number' ? filters.maxAmount : undefined;
  const sortByAmount =
    filters?.sortField === 'amount' || filters?.sortField === 'debt' || filters?.sortField === 'totalDebt';
  return { minAmount, maxAmount, sortByAmount };
}

export const buildingDelinquentsIntent: IntentDefinition = {
  name: 'building_delinquents',
  requiredPermission: 'payments.review' as Permission,
  supportedFilters: ['minAmount', 'maxAmount', 'limit', 'sortField', 'sortOrder', 'currency'],
  supportedResponseTypes: ['table', 'text'],
  executor: async (params): Promise<IntentExecutionResult> => {
    const { tenantId, entityIds, filters, pagination, prisma } = params;
    const buildingId = entityIds?.buildingId;

    if (!buildingId) {
      throw new BadRequestException('buildingId required for building_delinquents intent');
    }

    // Monetary comparisons (minAmount/maxAmount/monetary sort) require an
    // explicit currency: comparing amounts across different currencies has
    // no meaning without a conversion. The assistant must ask the user
    // which currency to use instead of guessing (no tenant/default/live FX).
    const monetary = hasMonetaryOperation(filters);
    const currency =
      typeof filters?.currency === 'string' && filters.currency.length > 0
        ? filters.currency
        : undefined;
    const wantsMonetaryComparison =
      monetary.minAmount !== undefined ||
      monetary.maxAmount !== undefined ||
      monetary.sortByAmount;
    if (wantsMonetaryComparison && !currency) {
      throw new BadRequestException(
        'currency required for monetary comparison in building_delinquents intent: ¿En qué moneda querés comparar la deuda?',
      );
    }

    const overdueCharges = await prisma.charge.findMany({
      where: {
        buildingId,
        tenantId,
        status: ChargeStatus.PENDING, // PENDING includes overdue when overdueSince is set
        overdueSince: { not: null },
        canceledAt: null,
      },
      include: {
        unit: { select: { id: true, code: true, label: true } },
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
    });

    // Group by unit with per-currency buckets + earliest delinquency.
    const unitDebts = new Map<
      string,
      {
        unitCode: string;
        label: string;
        earliestDue: Date;
        entries: Array<{ currency: string; amountMinor: number }>;
      }
    >();

    for (const charge of overdueCharges) {
      const unitKey = charge.unitId;
      const remainingDebt = debtCalculator.calculateChargeOutstanding(charge);

      if (remainingDebt <= 0) continue; // Skip fully paid

      const current = unitDebts.get(unitKey) ?? {
        unitCode: charge.unit.code,
        label: charge.unit.label || charge.unit.code,
        earliestDue: charge.dueDate,
        entries: [],
      };
      current.entries.push({ currency: charge.currency, amountMinor: remainingDebt });
      if (charge.dueDate < current.earliestDue) {
        current.earliestDue = charge.dueDate;
      }
      unitDebts.set(unitKey, current);
    }

    let delinquents = Array.from(unitDebts.values()).map((u) => ({
      unitCode: u.unitCode,
      label: u.label,
      outstandingByCurrency: aggregateReportBuckets(u.entries),
      earliestDue: u.earliestDue,
    }));

    if (wantsMonetaryComparison && currency) {
      // Same-currency comparison ONLY: filter/rank by the explicit
      // currency bucket; other buckets never participate.
      const minAmountMinor = monetary.minAmount !== undefined ? Math.round(monetary.minAmount * 100) : undefined;
      const maxAmountMinor = monetary.maxAmount !== undefined ? Math.round(monetary.maxAmount * 100) : undefined;

      delinquents = delinquents.filter((u) => {
        const bucket = u.outstandingByCurrency.find((b) => b.currency === currency);
        const amount = bucket?.amountMinor ?? 0;
        if (minAmountMinor !== undefined && amount < minAmountMinor) return false;
        if (maxAmountMinor !== undefined && amount > maxAmountMinor) return false;
        return true;
      });

      if (monetary.sortByAmount) {
        const order = filters?.sortOrder === 'asc' ? 1 : -1;
        delinquents.sort((a, b) => {
          const aAmount = a.outstandingByCurrency.find((b2) => b2.currency === currency)?.amountMinor ?? 0;
          const bAmount = b.outstandingByCurrency.find((b2) => b2.currency === currency)?.amountMinor ?? 0;
          return (aAmount - bAmount) * order;
        });
      } else {
        delinquents.sort((a, b) => {
          const dueDiff = a.earliestDue.getTime() - b.earliestDue.getTime();
          if (dueDiff !== 0) return dueDiff;
          return a.label.localeCompare(b.label);
        });
      }
    } else {
      // Default delinquency list: NON-monetary ordering
      // (earliest overdue dueDate ASC, then label ASC).
      delinquents.sort((a, b) => {
        const dueDiff = a.earliestDue.getTime() - b.earliestDue.getTime();
        if (dueDiff !== 0) return dueDiff;
        return a.label.localeCompare(b.label);
      });
    }

    delinquents = delinquents.slice(0, pagination?.limit || 20);

    return {
      data: {
        delinquents,
        totalUnitsWithDebt: delinquents.length,
        ...(wantsMonetaryComparison && currency ? { currency } : {}),
      },
    };
  },
};
