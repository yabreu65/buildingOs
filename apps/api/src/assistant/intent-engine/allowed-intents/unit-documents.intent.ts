import { BadRequestException } from '@nestjs/common';
import { Permission } from '../../../rbac/permissions';
import { IntentDefinition, IntentExecutionResult } from '../intent.types';

export const unitDocumentsIntent: IntentDefinition = {
  name: 'unit_documents',
  requiredPermission: 'units.read' as Permission,
  supportedFilters: ['category', 'limit', 'sortField', 'sortOrder'],
  supportedResponseTypes: ['table', 'text'],
  executor: async (params): Promise<IntentExecutionResult> => {
    const { tenantId, entityIds, filters, pagination, prisma } = params;
    const unitId = entityIds?.unitId;

    if (!unitId) {
      throw new BadRequestException('unitId required for unit_documents intent');
    }

    const whereClause: Record<string, unknown> = {
      unitId,
      tenantId,
    };

    if (filters?.category) {
      whereClause.category = filters.category;
    }

    const orderBy: Record<string, 'asc' | 'desc'> = {};
    if (filters?.sortField) {
      orderBy[filters.sortField] = filters?.sortOrder === 'desc' ? 'desc' : 'asc';
    } else {
      orderBy.createdAt = 'desc';
    }

    const documents = await prisma.document.findMany({
      where: whereClause,
      select: {
        id: true,
        title: true,
        category: true,
        visibility: true,
        createdAt: true,
      },
      take: pagination?.limit || 50,
      orderBy,
    });

    return {
      data: documents.map((doc) => ({
        name: doc.title,
        type: doc.category,
        createdAt: doc.createdAt,
      })),
    };
  },
};
