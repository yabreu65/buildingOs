import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Resolves the self-scope for a resident from the authenticated user only.
 * Historical UnitOccupant rows never grant current access.
 */
@Injectable()
export class ResidentAccessService {
  private static readonly privilegedRoles = new Set([
    'SUPER_ADMIN',
    'TENANT_OWNER',
    'TENANT_ADMIN',
    'OPERATOR',
  ]);

  constructor(private readonly prisma: PrismaService) {}

  shouldEnforce(userRoles: readonly string[]): boolean {
    return userRoles.includes('RESIDENT') && !userRoles.some((role) =>
      ResidentAccessService.privilegedRoles.has(role),
    );
  }

  async getActiveUnitIds(tenantId: string, userId: string, buildingId?: string): Promise<string[]> {
    const occupancies = await this.prisma.unitOccupant.findMany({
      where: {
        tenantId,
        endDate: null,
        member: { tenantId, userId, disabledAt: null },
        unit: { tenantId, ...(buildingId ? { buildingId } : {}) },
      },
      select: { unitId: true },
      distinct: ['unitId'],
    });

    return occupancies.map(({ unitId }) => unitId);
  }

  async getActiveBuildingIds(tenantId: string, userId: string): Promise<string[]> {
    const occupancies = await this.prisma.unitOccupant.findMany({
      where: {
        tenantId,
        endDate: null,
        member: { tenantId, userId, disabledAt: null },
        unit: { tenantId },
      },
      select: { unit: { select: { buildingId: true } } },
      distinct: ['unitId'],
    });

    return [...new Set(occupancies.map(({ unit }) => unit.buildingId))];
  }

  async assertUnitAccess(
    tenantId: string,
    userId: string,
    unitId: string,
    buildingId?: string,
  ): Promise<void> {
    const occupancy = await this.prisma.unitOccupant.findFirst({
      where: {
        tenantId,
        unitId,
        endDate: null,
        member: { tenantId, userId, disabledAt: null },
        unit: { tenantId, ...(buildingId ? { buildingId } : {}) },
      },
      select: { id: true },
    });

    if (!occupancy) {
      throw new NotFoundException('Unit not found or does not belong to you');
    }
  }

  async assertBuildingAccess(tenantId: string, userId: string, buildingId: string): Promise<void> {
    const unitIds = await this.getActiveUnitIds(tenantId, userId, buildingId);
    if (unitIds.length === 0) {
      throw new NotFoundException('Building not found or does not belong to you');
    }
  }
}
