import { BadRequestException } from '@nestjs/common';
import { Permission } from '../../../rbac/permissions';
import { IntentDefinition, IntentExecutionResult } from '../intent.types';

export const buildingDocumentsIntent: IntentDefinition = {
  name: 'building_documents',
  requiredPermission: 'buildings.read' as Permission,
  supportedFilters: ['category', 'limit', 'sortField', 'sortOrder'],
  supportedResponseTypes: ['table', 'text'],
  executor: async (params): Promise<IntentExecutionResult> => {
    const { tenantId, entityIds, filters, pagination, prisma } = params;
    const buildingId = entityIds?.buildingId;

    if (!buildingId) {
      throw new BadRequestException('buildingId required for building_documents intent');
    }

    const whereClause: Record<string, unknown> = {
      buildingId,
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
        unitId: true, // If unitId is set, it's a unit-specific doc within this building
      },
      take: pagination?.limit || 50,
      orderBy,
    });

    return {
      data: documents.map((doc) => ({
        name: doc.title,
        type: doc.category,
        visibility: doc.visibility,
        isUnitSpecific: !!doc.unitId,
        createdAt: doc.createdAt,
      })),
    };
  },
};
