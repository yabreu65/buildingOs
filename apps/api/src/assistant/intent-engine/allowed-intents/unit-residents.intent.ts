import { BadRequestException } from '@nestjs/common';
import { Permission } from '../../../rbac/permissions';
import { IntentDefinition, IntentExecutionResult } from '../intent.types';

export const unitResidentsIntent: IntentDefinition = {
  name: 'unit_residents',
  requiredPermission: 'units.read' as Permission,
  supportedFilters: ['limit', 'sortField', 'sortOrder'],
  supportedResponseTypes: ['table', 'text'],
  executor: async (params): Promise<IntentExecutionResult> => {
    const { tenantId, entityIds, filters, pagination, prisma } = params;
    const unitId = entityIds?.unitId;

    if (!unitId) {
      throw new BadRequestException('unitId required for unit_residents intent');
    }

    const residents = await prisma.unitOccupant.findMany({
      where: {
        unitId,
        tenantId,
        endDate: null, // Only active occupants
      },
      include: { member: true },
      take: pagination?.limit || 50,
      orderBy: { isPrimary: 'desc' },
    });

    return {
      data: residents.map((r) => ({
        name: r.member.name,
        role: r.role,
        isPrimary: r.isPrimary,
      })),
    };
  },
};
