import { BadRequestException } from '@nestjs/common';
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

    if (!buildingId) {
      throw new BadRequestException('buildingId required for building_payments intent');
    }

    const whereClause: Record<string, unknown> = {
      buildingId,
      tenantId,
    };

    if (filters?.status) {
      whereClause.status = filters.status;
    }

    if (filters?.method) {
      whereClause.method = filters.method;
    }

    if (filters?.period) {
      whereClause.paidAt = { gte: new Date(`${filters.period}-01`), lt: new Date(`${filters.period}-31`) };
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
        where: { buildingId, tenantId },
        _sum: { amount: true },
      }),
    ]);

    const sumByMethod: Record<string, number> = {};
    for (const group of methodSummary) {
      if (group._sum.amount) {
        sumByMethod[group.method] = group._sum.amount;
      }
    }

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
        total: payments.length,
      },
    };
  },
};
