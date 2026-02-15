import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';

@Injectable()
export class UnitsService {
  constructor(private prisma: PrismaService) {}

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
    const [currentCount, subscription] = await Promise.all([
      this.prisma.unit.count({ where: { building: { tenantId } } }),
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

    if (currentCount >= subscription.plan.maxUnits) {
      throw new ConflictException(
        `Unit limit reached: ${currentCount}/${subscription.plan.maxUnits}. Upgrade your plan to create more units.`,
      );
    }

    try {
      return await this.prisma.unit.create({
        data: {
          buildingId,
          code: dto.code,
          label: dto.label,
          unitType: dto.unitType || 'APARTMENT',
          occupancyStatus: dto.occupancyStatus || 'UNKNOWN',
        },
      });
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
      return await this.prisma.unit.update({
        where: { id: unitId },
        data: {
          code: dto.code,
          label: dto.label,
          unitType: dto.unitType,
          occupancyStatus: dto.occupancyStatus,
        },
        include: { unitOccupants: { include: { user: true } } },
      });
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
    await this.findOne(tenantId, buildingId, unitId);

    return await this.prisma.unit.delete({
      where: { id: unitId },
    });
  }
}
