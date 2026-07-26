import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ActiveResidentOccupancy {
  occupancyId: string;
  tenantId: string;
  buildingId: string;
  buildingName: string;
  buildingAlias: string;
  unitId: string;
  unitCode: string;
  unitLabel: string | null;
  memberId: string;
}

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

  async listActiveOccupancies(
    tenantId: string,
    userId: string,
    buildingId?: string,
  ): Promise<ActiveResidentOccupancy[]> {
    const occupancies = await this.prisma.unitOccupant.findMany({
      where: {
        tenantId,
        endDate: null,
        member: { tenantId, userId, disabledAt: null },
        unit: { tenantId, ...(buildingId ? { buildingId } : {}) },
      },
      select: {
        id: true,
        memberId: true,
        unitId: true,
        unit: {
          select: {
            id: true,
            code: true,
            label: true,
            building: {
              select: {
                id: true,
                name: true,
                alias: true,
              },
            },
          },
        },
      },
    });

    const sorted = occupancies
      .map((occupancy) => ({
        occupancyId: occupancy.id,
        tenantId,
        buildingId: occupancy.unit.building.id,
        buildingName: occupancy.unit.building.name,
        buildingAlias: occupancy.unit.building.alias,
        unitId: occupancy.unit.id,
        unitCode: occupancy.unit.code,
        unitLabel: occupancy.unit.label ?? null,
        memberId: occupancy.memberId,
      }))
      .sort((a, b) =>
        a.buildingAlias.localeCompare(b.buildingAlias, 'es', { numeric: true, sensitivity: 'base' }) ||
        a.buildingName.localeCompare(b.buildingName, 'es', { numeric: true, sensitivity: 'base' }) ||
        a.unitCode.localeCompare(b.unitCode, 'es', { numeric: true, sensitivity: 'base' }) ||
        (a.unitLabel ?? '').localeCompare(b.unitLabel ?? '', 'es', { numeric: true, sensitivity: 'base' }) ||
        a.unitId.localeCompare(b.unitId, 'es', { numeric: true, sensitivity: 'base' }),
      );

    return sorted;
  }

  async resolveActiveResidentOccupancy(params: {
    tenantId: string;
    userId: string;
    unitId?: string;
    buildingId?: string;
  }): Promise<ActiveResidentOccupancy | null> {
    const { tenantId, userId, unitId, buildingId } = params;
    const occupancies = await this.listActiveOccupancies(tenantId, userId, buildingId);

    if (unitId) {
      return occupancies.find((occupancy) => occupancy.unitId === unitId) ?? null;
    }

    return occupancies[0] ?? null;
  }

  async getActiveUnitIds(tenantId: string, userId: string, buildingId?: string): Promise<string[]> {
    const occupancies = await this.listActiveOccupancies(tenantId, userId, buildingId);
    return occupancies.map(({ unitId }) => unitId);
  }

  async getActiveBuildingIds(tenantId: string, userId: string): Promise<string[]> {
    const occupancies = await this.listActiveOccupancies(tenantId, userId);
    return [...new Set(occupancies.map(({ buildingId: activeBuildingId }) => activeBuildingId))];
  }

  async assertUnitAccess(
    tenantId: string,
    userId: string,
    unitId: string,
    buildingId?: string,
  ): Promise<void> {
    const occupancy = await this.resolveActiveResidentOccupancy({
      tenantId,
      userId,
      unitId,
      buildingId,
    });

    if (!occupancy) {
      throw new NotFoundException('Unit not found or does not belong to you');
    }
  }

  async assertBuildingAccess(tenantId: string, userId: string, buildingId: string): Promise<void> {
    const occupancy = await this.resolveActiveResidentOccupancy({
      tenantId,
      userId,
      buildingId,
    });

    if (!occupancy) {
      throw new NotFoundException('Building not found or does not belong to you');
    }
  }
}
