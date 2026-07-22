import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Unit, Prisma, AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlanEntitlementsService } from '../billing/plan-entitlements.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizeService } from '../rbac/authorize.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';

export interface UnitWithDisplayCode extends Unit {
  building: { id: string; name: string; alias: string };
  displayCode: string;
}

function addDisplayCode<T extends Unit & { building?: { alias?: string | null } | null }>(
  unit: T,
): T & { displayCode: string } {
  const alias = unit.building?.alias;
  const displayCode = alias ? `${alias}-${unit.code}` : unit.code;
  return { ...unit, displayCode };
}

@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planEntitlements: PlanEntitlementsService,
    private readonly auditService: AuditService,
    private readonly authorizeService: AuthorizeService,
  ) {}

  /**
   * Create a new unit inside a building
   */
  async create(
    tenantId: string,
    buildingId: string,
    userId: string,
    dto: CreateUnitDto,
  ): Promise<Unit> {
    // RBAC: check permission
    const hasAccess = await this.authorizeService.authorize({
      userId,
      tenantId,
      permission: 'units.write',
      buildingId,
    });
    if (!hasAccess) {
      throw new ForbiddenException('No tiene permiso para crear unidades');
    }

    // Verify building belongs to tenant
    const building = await this.prisma.building.findFirst({
      where: { id: buildingId, tenantId, deletedAt: null },
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
          tenantId,
          buildingId,
          code: dto.code,
          label: dto.label,
          unitType: dto.unitType || 'APARTMENT',
          occupancyStatus: dto.occupancyStatus || 'UNKNOWN',
          m2: dto.m2,
        },
        include: {
          building: { select: { id: true, name: true, alias: true } },
          unitCategory: { select: { id: true, name: true } },
          unitOccupants: { include: { member: true } },
        },
      });

      // Audit: UNIT_CREATE
      void this.auditService.createLog({
        tenantId,
        actorUserId: userId,
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

      return addDisplayCode(unit);
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
  async findAllByTenant(tenantId: string, buildingId?: string, unitIds?: string[]): Promise<UnitWithDisplayCode[]> {
    const where: Prisma.UnitWhereInput = {
      tenantId,
    };

    if (buildingId) {
      where.buildingId = buildingId;
    }
    if (unitIds) {
      where.id = { in: unitIds };
    }

    const units = await this.prisma.unit.findMany({
      where,
      include: {
        building: { select: { id: true, name: true, alias: true } },
        unitCategory: { select: { id: true, name: true } },
        unitOccupants: { include: { member: true } },
      },
      orderBy: [{ building: { name: 'asc' } }, { label: 'asc' }],
    });

    return units.map(addDisplayCode);
  }

  /**
   * List all units in a building, scoped to tenant
   */
  async findAll(tenantId: string, buildingId: string, unitIds?: string[]): Promise<UnitWithDisplayCode[]> {
    // Verify building belongs to tenant
    const building = await this.prisma.building.findFirst({
      where: { id: buildingId, tenantId, deletedAt: null },
    });

    if (!building) {
      throw new NotFoundException(
        `Building not found or does not belong to this tenant`,
      );
    }

    const units = await this.prisma.unit.findMany({
      where: { tenantId, buildingId, ...(unitIds ? { id: { in: unitIds } } : {}) },
      include: {
        building: { select: { id: true, name: true, alias: true } },
        unitCategory: { select: { id: true, name: true } },
        unitOccupants: { include: { member: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return units.map(addDisplayCode);
  }

  /**
   * Get a single unit by ID, scoped to tenant and building
   */
  async findOne(tenantId: string, buildingId: string, unitId: string): Promise<UnitWithDisplayCode> {
    // Verify building belongs to tenant
    const building = await this.prisma.building.findFirst({
      where: { id: buildingId, tenantId, deletedAt: null },
    });

    if (!building) {
      throw new NotFoundException(
        `Building not found or does not belong to this tenant`,
      );
    }

    const unit = await this.prisma.unit.findFirst({
      where: { id: unitId, tenantId, buildingId },
      include: {
        building: { select: { id: true, name: true, alias: true } },
        unitCategory: { select: { id: true, name: true } },
        unitOccupants: { include: { member: true } },
      },
    });

    if (!unit) {
      throw new NotFoundException(
        `Unit not found or does not belong to this building`,
      );
    }

    return addDisplayCode(unit);
  }

  /**
   * Update a unit's properties
   */
  async update(
    tenantId: string,
    buildingId: string,
    unitId: string,
    userId: string,
    dto: UpdateUnitDto,
  ): Promise<Unit> {
    // RBAC: check permission
    const hasAccess = await this.authorizeService.authorize({
      userId,
      tenantId,
      permission: 'units.write',
      buildingId,
      unitId,
    });
    if (!hasAccess) {
      throw new ForbiddenException('No tiene permiso para modificar unidades');
    }

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
          building: { select: { id: true, name: true, alias: true } },
          unitCategory: { select: { id: true, name: true } },
          unitOccupants: { include: { member: true } },
        },
      });

      // Audit: UNIT_UPDATE
      void this.auditService.createLog({
        tenantId,
        actorUserId: userId,
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

      return addDisplayCode(updatedUnit);
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
   * Delete a unit (must be vacant, no charges/payments)
   */
  async remove(
    tenantId: string,
    buildingId: string,
    unitId: string,
    userId: string,
  ): Promise<Unit> {
    // RBAC: check permission
    const hasAccess = await this.authorizeService.authorize({
      userId,
      tenantId,
      permission: 'units.write',
      buildingId,
      unitId,
    });
    if (!hasAccess) {
      throw new ForbiddenException('No tiene permiso para eliminar unidades');
    }

    // Verify building belongs to tenant and unit belongs to building
    const unit = await this.findOne(tenantId, buildingId, unitId);

    // Validate: check for active charges
    const activeCharges = await this.prisma.charge.count({
      where: { tenantId, unitId, canceledAt: null },
    });
    if (activeCharges > 0) {
      throw new BadRequestException(
        'No se puede eliminar una unidad con cargos activos. Cancele los cargos primero.',
      );
    }

    // Validate: check for payments
    const payments = await this.prisma.payment.count({
      where: { tenantId, unitId, canceledAt: null },
    });
    if (payments > 0) {
      throw new BadRequestException(
        'No se puede eliminar una unidad con pagos asociados.',
      );
    }

    // Validate: check for occupants
    const occupants = await this.prisma.unitOccupant.count({
      where: { tenantId, unitId, endDate: null },
    });
    if (occupants > 0) {
      throw new BadRequestException(
        'No se puede eliminar una unidad con ocupantes activos. Retire los ocupantes primero.',
      );
    }

    // Fetch full unit with building before deleting (Prisma delete doesn't support include)
    const unitToDelete = await this.prisma.unit.findFirst({
      where: { id: unitId, tenantId, buildingId },
      include: {
        building: { select: { id: true, name: true, alias: true } },
        unitCategory: { select: { id: true, name: true } },
        unitOccupants: { include: { member: true } },
      },
    });

    if (!unitToDelete) {
      throw new NotFoundException(
        `Unit not found or does not belong to this building`,
      );
    }

    const deletedUnit = await this.prisma.unit.delete({
      where: { id: unitId },
    });

    // Audit: UNIT_DELETE
    void this.auditService.createLog({
      tenantId,
      actorUserId: userId,
      action: AuditAction.UNIT_DELETE,
      entityType: 'Unit',
      entityId: unitId,
      metadata: {
        buildingId,
        code: deletedUnit.code,
        label: deletedUnit.label,
      },
    });

    return addDisplayCode(unitToDelete);
  }
}
