import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateOccupantDto } from './dto/create-occupant.dto';
import { AuditAction } from '@prisma/client';

@Injectable()
export class OccupantsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  async assignOccupant(
    tenantId: string,
    buildingId: string,
    unitId: string,
    dto: CreateOccupantDto,
    actorUserId?: string,
  ) {
    // Verify unit exists and belongs to building/tenant
    const unit = await this.prisma.unit.findFirst({
      where: { id: unitId, building: { id: buildingId, tenantId } },
    });

    if (!unit) {
      throw new NotFoundException(
        `Unit not found or does not belong to this building/tenant`,
      );
    }

    // Verify user exists in the same tenant
    const userInTenant = await this.prisma.membership.findFirst({
      where: { userId: dto.userId, tenantId },
    });

    if (!userInTenant) {
      throw new BadRequestException(
        `User not found in this tenant`,
      );
    }

    // Check plan limit: maxOccupants
    const [currentCount, subscription] = await Promise.all([
      this.prisma.unitOccupant.count({
        where: { unit: { building: { tenantId } } },
      }),
      this.prisma.subscription.findUnique({
        where: { tenantId },
        include: { plan: true },
      }),
    ]);

    if (!subscription) {
      throw new BadRequestException(
        'Tenant has no active subscription',
      );
    }

    if (currentCount >= subscription.plan.maxOccupants) {
      throw new ConflictException(
        `Occupant limit reached: ${currentCount}/${subscription.plan.maxOccupants}. Upgrade your plan to add more occupants.`,
      );
    }

    try {
      const occupant = await this.prisma.unitOccupant.create({
        data: {
          unitId,
          userId: dto.userId,
          role: dto.role,
        },
        include: { user: true, unit: true },
      });

      // Audit: OCCUPANT_ASSIGN
      if (actorUserId) {
        void this.auditService.createLog({
          tenantId,
          actorUserId,
          action: AuditAction.OCCUPANT_ASSIGN,
          entityType: 'UnitOccupant',
          entityId: occupant.id,
          metadata: {
            unitId,
            userId: dto.userId,
            role: dto.role,
          },
        });
      }

      return occupant;
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new BadRequestException(
          `This user is already assigned to this unit with role ${dto.role}`,
        );
      }
      throw error;
    }
  }

  async findOccupants(tenantId: string, buildingId: string, unitId: string) {
    // Verify unit exists and belongs to building/tenant
    const unit = await this.prisma.unit.findFirst({
      where: { id: unitId, building: { id: buildingId, tenantId } },
    });

    if (!unit) {
      throw new NotFoundException(
        `Unit not found or does not belong to this building/tenant`,
      );
    }

    return await this.prisma.unitOccupant.findMany({
      where: { unitId },
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async removeOccupant(
    tenantId: string,
    buildingId: string,
    unitId: string,
    occupantId: string,
    actorUserId?: string,
  ) {
    // Verify unit exists and belongs to building/tenant
    const unit = await this.prisma.unit.findFirst({
      where: { id: unitId, building: { id: buildingId, tenantId } },
    });

    if (!unit) {
      throw new NotFoundException(
        `Unit not found or does not belong to this building/tenant`,
      );
    }

    // Verify occupant exists and belongs to this unit
    const occupant = await this.prisma.unitOccupant.findFirst({
      where: { id: occupantId, unitId },
    });

    if (!occupant) {
      throw new NotFoundException(
        `Occupant not found or does not belong to this unit`,
      );
    }

    const deleted = await this.prisma.unitOccupant.delete({
      where: { id: occupantId },
    });

    // Audit: OCCUPANT_REMOVE
    if (actorUserId) {
      void this.auditService.createLog({
        tenantId,
        actorUserId,
        action: AuditAction.OCCUPANT_REMOVE,
        entityType: 'UnitOccupant',
        entityId: occupantId,
        metadata: {
          unitId,
          userId: occupant.userId,
          role: occupant.role,
        },
      });
    }

    return deleted;
  }
}
