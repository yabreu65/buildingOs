import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Building } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PlanEntitlementsService } from '../billing/plan-entitlements.service';
import { CreateBuildingDto } from './dto/create-building.dto';
import { UpdateBuildingDto } from './dto/update-building.dto';
import { AuditAction } from '@prisma/client';

@Injectable()
export class BuildingsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private planEntitlements: PlanEntitlementsService,
  ) {}

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

  async findAll(tenantId: string): Promise<
    (Building & { units: unknown[] })[]
  > {
    return await this.prisma.building.findMany({
      where: { tenantId },
      include: { units: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, buildingId: string): Promise<
    Building & { units: unknown[] }
  > {
    const building = await this.prisma.building.findFirst({
      where: { id: buildingId, tenantId },
      include: { units: { include: { unitOccupants: { include: { user: true } } } } },
    });

    if (!building) {
      throw new NotFoundException(
        `Building not found or does not belong to this tenant`,
      );
    }

    return building;
  }

  async update(tenantId: string, buildingId: string, dto: UpdateBuildingDto, userId?: string): Promise<Building & { units: unknown[] }> {
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
