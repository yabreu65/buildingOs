import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBuildingDto } from './dto/create-building.dto';
import { UpdateBuildingDto } from './dto/update-building.dto';

@Injectable()
export class BuildingsService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateBuildingDto) {
    try {
      return await this.prisma.building.create({
        data: {
          tenantId,
          name: dto.name,
          address: dto.address,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new BadRequestException(
          `Building name "${dto.name}" already exists in this tenant`,
        );
      }
      throw error;
    }
  }

  async findAll(tenantId: string) {
    return await this.prisma.building.findMany({
      where: { tenantId },
      include: { units: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, buildingId: string) {
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

  async update(tenantId: string, buildingId: string, dto: UpdateBuildingDto) {
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
      return await this.prisma.building.update({
        where: { id: buildingId },
        data: {
          name: dto.name,
          address: dto.address,
        },
        include: { units: true },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new BadRequestException(
          `Building name "${dto.name}" already exists in this tenant`,
        );
      }
      throw error;
    }
  }

  async remove(tenantId: string, buildingId: string) {
    // Verify building belongs to tenant
    const building = await this.prisma.building.findFirst({
      where: { id: buildingId, tenantId },
    });

    if (!building) {
      throw new NotFoundException(
        `Building not found or does not belong to this tenant`,
      );
    }

    return await this.prisma.building.delete({
      where: { id: buildingId },
    });
  }
}
