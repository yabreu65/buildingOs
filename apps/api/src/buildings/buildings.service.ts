import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Building, TenantMember, Unit, UnitOccupant } from '@prisma/client';


import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PlanEntitlementsService } from '../billing/plan-entitlements.service';
import { CreateBuildingDto } from './dto/create-building.dto';
import { UpdateBuildingDto } from './dto/update-building.dto';

export interface BuildingWithUnits extends Building { units: Unit[] }
export interface BuildingWithUnitsDetail extends Building {
  units: (Unit & { unitOccupants: (UnitOccupant & { member: TenantMember })[] })[];
}

@Injectable()
export class BuildingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly planEntitlements: PlanEntitlementsService,
  ) {}

  /**
   * Create a new building for the tenant
   */
  async create(tenantId: string, dto: CreateBuildingDto, userId?: string): Promise<Building> {
    // 1. Check plan limit: maxBuildings
    await this.planEntitlements.assertLimit(tenantId, 'buildings');

    // 2. Create building
    try {
      const building = await this.prisma.building.create({
        data: {
          tenantId,
          name: dto.name,
          address: dto.address,
        },
      });

      // Audit: BUILDING_CREATE
      if (userId) {
        void this.auditService.createLog({
          tenantId,
          actorUserId: userId,
          action: AuditAction.BUILDING_CREATE,
          entityType: 'Building',
          entityId: building.id,
          metadata: {
            name: building.name,
            address: building.address,
          },
        });
      }

      return building;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          `Building name "${dto.name}" already exists in this tenant`,
        );
      }
      throw error;
    }
  }

  /**
   * List all buildings for a tenant
   */
  async findAll(tenantId: string): Promise<
    (BuildingWithUnits)[]
  > {
    return await this.prisma.building.findMany({
      where: { tenantId },
      include: { units: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a single building by ID, scoped to tenant
   */
  async findOne(tenantId: string, buildingId: string): Promise<BuildingWithUnitsDetail> {
    const building = await this.prisma.building.findFirst({
      where: { id: buildingId, tenantId },
      include: { units: { include: { unitOccupants: { include: { member: true } } } } },
    });

    if (!building) {
      throw new NotFoundException(
        `Building not found or does not belong to this tenant`,
      );
    }

    return building;
  }

  /**
   * Update building name/address
   */
  async update(tenantId: string, buildingId: string, dto: UpdateBuildingDto, userId?: string): Promise<BuildingWithUnits> {
    // Verify building belongs to tenant
    const building = await this.prisma.building.findFirst({
      where: { id: buildingId, tenantId },
    });

    if (!building) {
      throw new NotFoundException(
        `Building not found or does not belong to this tenant`,
      );
    }

    try {
      const updated = await this.prisma.building.update({
        where: { id: buildingId },
        data: {
          name: dto.name,
          address: dto.address,
        },
        include: { units: true },
      });

      // Audit: BUILDING_UPDATE
      if (userId) {
        void this.auditService.createLog({
          tenantId,
          actorUserId: userId,
          action: AuditAction.BUILDING_UPDATE,
          entityType: 'Building',
          entityId: buildingId,
          metadata: {
            name: updated.name,
            address: updated.address,
          },
        });
      }

      return updated;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          `Building name "${dto.name}" already exists in this tenant`,
        );
      }
      throw error;
    }
  }

  /**
   * Delete a building (cascades to units/occupants)
   */
  async remove(tenantId: string, buildingId: string, userId?: string): Promise<Building> {
    // Verify building belongs to tenant
    const building = await this.prisma.building.findFirst({
      where: { id: buildingId, tenantId },
    });

    if (!building) {
      throw new NotFoundException(
        `Building not found or does not belong to this tenant`,
      );
    }

    const deleted = await this.prisma.building.delete({
      where: { id: buildingId },
    });

    // Audit: BUILDING_DELETE
    if (userId) {
      void this.auditService.createLog({
        tenantId,
        actorUserId: userId,
        action: AuditAction.BUILDING_DELETE,
        entityType: 'Building',
        entityId: buildingId,
        metadata: {
          name: building.name,
        },
      });
    }

    return deleted;
  }
}
