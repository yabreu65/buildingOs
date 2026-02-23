import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanEntitlementsService } from '../billing/plan-entitlements.service';
import { AuditService } from '../audit/audit.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { AuditAction } from '@prisma/client';

@Injectable()
export class UnitsService {
  constructor(
    private prisma: PrismaService,
    private planEntitlements: PlanEntitlementsService,
    private auditService: AuditService,
  ) {}

  async create(tenantId: string, buildingId: string, dto: CreateUnitDto) {
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
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new BadRequestException(
          `Unit code "${dto.code}" already exists in this building`,
        );
      }
      throw error;
    }
  }

  async findAll(tenantId: string, buildingId: string) {
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
      include: { unitOccupants: { include: { user: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, buildingId: string, unitId: string) {
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
      include: { unitOccupants: { include: { user: true } } },
    });

    if (!unit) {
      throw new NotFoundException(
        `Unit not found or does not belong to this building`,
      );
    }

    return unit;
  }

  async update(tenantId: string, buildingId: string, unitId: string, dto: UpdateUnitDto) {
    // Verify building belongs to tenant and unit belongs to building
    const unit = await this.findOne(tenantId, buildingId, unitId);

    try {
      const updatedUnit = await this.prisma.unit.update({
        where: { id: unitId },
        data: {
          code: dto.code,
          label: dto.label,
          unitType: dto.unitType,
          occupancyStatus: dto.occupancyStatus,
        },
        include: { unitOccupants: { include: { user: true } } },
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
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new BadRequestException(
          `Unit code "${dto.code}" already exists in this building`,
        );
      }
      throw error;
    }
  }

  async remove(tenantId: string, buildingId: string, unitId: string) {
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
