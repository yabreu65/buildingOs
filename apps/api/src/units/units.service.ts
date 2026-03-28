import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Unit, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlanEntitlementsService } from '../billing/plan-entitlements.service';
import { AuditService } from '../audit/audit.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { AuditAction } from '@prisma/client';

@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planEntitlements: PlanEntitlementsService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Create a new unit inside a building
   */
  async create(tenantId: string, buildingId: string, dto: CreateUnitDto): Promise<Unit> {
    // Verify building belongs to tenant
    const building = await this.prisma.building.findFirst({
      where: { id: buildingId, tenantId },
    });

    if (!building) {
      throw new NotFoundException(
        `Building not found or does not belong to this tenant`,
      );
    }

    // Check plan limit: maxUnits
    await this.planEntitlements.assertLimit(tenantId, 'units');

    try {
      const unit = await this.prisma.unit.create({
        data: {
          buildingId,
          code: dto.code,
          label: dto.label,
          unitType: dto.unitType || 'APARTMENT',
          occupancyStatus: dto.occupancyStatus || 'UNKNOWN',
          m2: dto.m2,
        },
        include: {
          unitCategory: { select: { id: true, name: true } },
          unitOccupants: { include: { member: true } },
        },
      });

      // Audit: UNIT_CREATE
      void this.auditService.createLog({
        tenantId,
        action: AuditAction.UNIT_CREATE,
        entityType: 'Unit',
        entityId: unit.id,
        metadata: {
          buildingId,
          code: unit.code,
          label: unit.label,
          unitType: unit.unitType,
        },
      });

      return unit;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          `Unit code "${dto.code}" already exists in this building`,
        );
      }
      throw error;
    }
  }

  /**
   * Get all units for a tenant (optionally filtered by buildingId)
   * Multi-tenant safe: filters by building.tenantId
   */
  async findAllByTenant(tenantId: string, buildingId?: string): Promise<Unit[]> {
    const where: Prisma.UnitWhereInput = {
      building: { tenantId },
    };

    if (buildingId) {
      where.buildingId = buildingId;
    }

    return await this.prisma.unit.findMany({
      where,
      include: {
        building: { select: { id: true, name: true } },
        unitCategory: { select: { id: true, name: true } },
        unitOccupants: { include: { member: true } },
      },
      orderBy: [{ building: { name: 'asc' } }, { label: 'asc' }],
    });
  }

  /**
   * List all units in a building, scoped to tenant
   */
  async findAll(tenantId: string, buildingId: string): Promise<Unit[]> {
    // Verify building belongs to tenant
    const building = await this.prisma.building.findFirst({
      where: { id: buildingId, tenantId },
    });

    if (!building) {
      throw new NotFoundException(
        `Building not found or does not belong to this tenant`,
      );
    }

    return await this.prisma.unit.findMany({
      where: { buildingId },
      include: {
        unitCategory: { select: { id: true, name: true } },
        unitOccupants: { include: { member: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a single unit by ID, scoped to tenant and building
   */
  async findOne(tenantId: string, buildingId: string, unitId: string): Promise<Unit> {
    // Verify building belongs to tenant
    const building = await this.prisma.building.findFirst({
      where: { id: buildingId, tenantId },
    });

    if (!building) {
      throw new NotFoundException(
        `Building not found or does not belong to this tenant`,
      );
    }

    const unit = await this.prisma.unit.findFirst({
      where: { id: unitId, buildingId },
      include: {
        unitCategory: { select: { id: true, name: true } },
        unitOccupants: { include: { member: true } },
      },
    });

    if (!unit) {
      throw new NotFoundException(
        `Unit not found or does not belong to this building`,
      );
    }

    return unit;
  }

  /**
   * Update a unit's properties
   */
  async update(tenantId: string, buildingId: string, unitId: string, dto: UpdateUnitDto): Promise<Unit> {
    // Verify building belongs to tenant and unit belongs to building
    await this.findOne(tenantId, buildingId, unitId);

    try {
      const updatedUnit = await this.prisma.unit.update({
        where: { id: unitId },
        data: {
          code: dto.code,
          label: dto.label,
          unitType: dto.unitType,
          occupancyStatus: dto.occupancyStatus,
          m2: dto.m2,
          unitCategoryId: dto.unitCategoryId,
        },
        include: {
          unitCategory: { select: { id: true, name: true } },
          unitOccupants: { include: { member: true } },
        },
      });

      // Audit: UNIT_UPDATE
      void this.auditService.createLog({
        tenantId,
        action: AuditAction.UNIT_UPDATE,
        entityType: 'Unit',
        entityId: unitId,
        metadata: {
          buildingId,
          code: updatedUnit.code,
          label: updatedUnit.label,
          unitType: updatedUnit.unitType,
          occupancyStatus: updatedUnit.occupancyStatus,
        },
      });

      return updatedUnit;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          `Unit code "${dto.code}" already exists in this building`,
        );
      }
      throw error;
    }
  }

  /**
   * Delete a unit (must be vacant)
   */
  async remove(tenantId: string, buildingId: string, unitId: string): Promise<Unit> {
    // Verify building belongs to tenant and unit belongs to building
    const unit = await this.findOne(tenantId, buildingId, unitId);

    const deletedUnit = await this.prisma.unit.delete({
      where: { id: unitId },
    });

    // Audit: UNIT_DELETE
    void this.auditService.createLog({
      tenantId,
      action: AuditAction.UNIT_DELETE,
      entityType: 'Unit',
      entityId: unitId,
      metadata: {
        buildingId,
        code: unit.code,
        label: unit.label,
      },
    });

    return deletedUnit;
  }
}
