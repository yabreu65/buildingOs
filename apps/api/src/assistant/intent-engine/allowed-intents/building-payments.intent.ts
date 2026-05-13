import { Permission } from '../../../rbac/permissions';
import { IntentDefinition, IntentExecutionResult } from '../intent.types';

export const buildingPaymentsIntent: IntentDefinition = {
  name: 'building_payments',
  requiredPermission: 'payments.review' as Permission,
  supportedFilters: ['period', 'status', 'method', 'minAmount', 'maxAmount', 'limit', 'sortField', 'sortOrder'],
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

    if (filters?.minAmount) {
      whereClause.amount = { ...((whereClause.amount as Record<string, number>) || {}), gte: filters.minAmount };
    }

    if (filters?.maxAmount) {
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
          method: true,
          status: true,
          paidAt: true,
          unitId: true,
          reference: true,
        },
        take: pagination?.limit || 50,
        orderBy,
      }),
      // Sum by method
      prisma.payment.groupBy({
        by: ['method'],
        where: whereClause,
        _sum: { amount: true },
      }),
    ]);

    const sumByMethod: Record<string, number> = {};
    for (const group of methodSummary) {
      if (group._sum.amount) {
        sumByMethod[group.method] = group._sum.amount;
      }
    }

    const totalAmount = payments.reduce((acc, payment) => acc + Number(payment.amount || 0), 0);

    return {
      data: {
        payments: payments.map((p) => ({
          amount: p.amount,
          method: p.method,
          paidAt: p.paidAt,
          status: p.status,
          isUnitSpecific: !!p.unitId,
        })),
        sumByMethod,
        totalAmount,
        total: payments.length,
      },
    };
  },
};
