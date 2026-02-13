import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOccupantDto } from './dto/create-occupant.dto';

@Injectable()
export class OccupantsService {
  constructor(private prisma: PrismaService) {}

  async assignOccupant(
    tenantId: string,
    buildingId: string,
    unitId: string,
    dto: CreateOccupantDto,
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

    try {
      return await this.prisma.unitOccupant.create({
        data: {
          unitId,
          userId: dto.userId,
          role: dto.role,
        },
        include: { user: true, unit: true },
      });
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

    return await this.prisma.unitOccupant.delete({
      where: { id: occupantId },
    });
  }
}
