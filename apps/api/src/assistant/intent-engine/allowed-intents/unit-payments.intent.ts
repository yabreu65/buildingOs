import { BadRequestException } from '@nestjs/common';
import { Permission } from '../../../rbac/permissions';
import { IntentDefinition, IntentExecutionResult } from '../intent.types';
import { aggregateReportBuckets } from '../../../finanzas/currency-buckets';

export const unitPaymentsIntent: IntentDefinition = {
  name: 'unit_payments',
  requiredPermission: 'payments.review' as Permission,
  supportedFilters: ['period', 'status', 'method', 'currency', 'minAmount', 'maxAmount', 'limit', 'sortField', 'sortOrder'],
  supportedResponseTypes: ['table', 'text'],
  executor: async (params): Promise<IntentExecutionResult> => {
    const { tenantId, entityIds, filters, pagination, prisma } = params;
    const unitId = entityIds?.unitId;

    if (!unitId) {
      throw new BadRequestException('unitId required for unit_payments intent');
    }

    const whereClause: Record<string, unknown> = {
      unitId,
      tenantId,
    };

    if (filters?.status) {
      whereClause.status = filters.status;
    }

    if (filters?.method) {
      whereClause.method = filters.method;
    }

    if (filters?.period) {
      const periodStart = new Date(`${filters.period}-01T00:00:00.000Z`);
      if (!Number.isNaN(periodStart.getTime())) {
        const periodEnd = new Date(periodStart);
        periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
        whereClause.paidAt = { gte: periodStart, lt: periodEnd };
      }
    }

    const needsCurrency = filters?.minAmount !== undefined
      || filters?.maxAmount !== undefined
      || filters?.sortField === 'amount';
    if (needsCurrency && !filters?.currency) {
      throw new BadRequestException('currency is required for amount filters and amount sorting');
    }
    if (filters?.currency) {
      whereClause.currency = filters.currency;
    }

    if (filters?.minAmount !== undefined) {
      whereClause.amount = { ...((whereClause.amount as Record<string, number>) || {}), gte: filters.minAmount };
    }

    if (filters?.maxAmount !== undefined) {
      whereClause.amount = { ...((whereClause.amount as Record<string, number>) || {}), lte: filters.maxAmount };
    }

    const orderBy: Record<string, 'asc' | 'desc'> = {};
    if (filters?.sortField) {
      orderBy[filters.sortField] = filters?.sortOrder === 'desc' ? 'desc' : 'asc';
    } else {
      orderBy.paidAt = 'desc';
    }

    const payments = await prisma.payment.findMany({
        where: whereClause,
        select: {
          id: true,
          amount: true,
          currency: true,
          method: true,
          status: true,
          paidAt: true,
          reference: true,
        },
        take: pagination?.limit || 50,
        orderBy,
      });

    const totalAmountByCurrency = aggregateReportBuckets(
      payments.map((payment) => ({
        currency: payment.currency,
        amountMinor: Number(payment.amount ?? 0),
      })),
    );

    return {
      data: {
        payments: payments.map((payment) => ({
          amount: payment.amount,
          currency: payment.currency,
          method: payment.method,
          paidAt: payment.paidAt,
          status: payment.status,
        })),
        total: payments.length,
        totalAmountByCurrency,
      },
    };
  },
};
