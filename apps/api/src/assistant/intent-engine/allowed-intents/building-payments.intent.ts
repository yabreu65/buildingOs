import { BadRequestException } from '@nestjs/common';
import { Permission } from '../../../rbac/permissions';
import { IntentDefinition, IntentExecutionResult } from '../intent.types';
import {
  aggregateReportBuckets,
  type ReportCurrencyAmountBucket,
} from '../../../finanzas/currency-buckets';

export const buildingPaymentsIntent: IntentDefinition = {
  name: 'building_payments',
  requiredPermission: 'payments.review' as Permission,
  supportedFilters: ['period', 'status', 'method', 'currency', 'minAmount', 'maxAmount', 'limit', 'sortField', 'sortOrder'],
  supportedResponseTypes: ['table', 'text'],
  executor: async (params): Promise<IntentExecutionResult> => {
    const { tenantId, entityIds, filters, pagination, prisma } = params;
    const buildingId = entityIds?.buildingId;
    const whereClause: Record<string, unknown> = {
      tenantId,
    };

    if (buildingId) {
      whereClause.buildingId = buildingId;
    }

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

    const [payments, methodSummary] = await Promise.all([
      prisma.payment.findMany({
        where: whereClause,
        select: {
          id: true,
          amount: true,
          currency: true,
          method: true,
          status: true,
          paidAt: true,
          unitId: true,
          reference: true,
        },
        take: pagination?.limit || 50,
        orderBy,
      }),
      // Sum by method and stored currency.
      prisma.payment.groupBy({
        by: ['method', 'currency'],
        where: whereClause,
        _sum: { amount: true },
      }),
    ]);

    const sumByMethodEntries: Record<string, Array<{ currency: string; amountMinor: number }>> = {};
    for (const group of methodSummary) {
      const entries = sumByMethodEntries[group.method] ?? [];
      entries.push({
        currency: group.currency,
        amountMinor: Number(group._sum.amount ?? 0),
      });
      sumByMethodEntries[group.method] = entries;
    }
    const sumByMethod: Record<string, ReportCurrencyAmountBucket[]> = {};
    for (const [method, entries] of Object.entries(sumByMethodEntries)) {
      sumByMethod[method] = aggregateReportBuckets(entries);
    }

    const totalAmountByCurrency = aggregateReportBuckets(
      payments.map((payment) => ({
        currency: payment.currency,
        amountMinor: Number(payment.amount ?? 0),
      })),
    );

    return {
      data: {
        payments: payments.map((p) => ({
          amount: p.amount,
          currency: p.currency,
          method: p.method,
          paidAt: p.paidAt,
          status: p.status,
          isUnitSpecific: !!p.unitId,
        })),
        sumByMethod,
        totalAmountByCurrency,
        total: payments.length,
      },
    };
  },
};
