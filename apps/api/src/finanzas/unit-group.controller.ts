import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../common/types/request.types';
import { UnitGroupService } from './unit-group.service';

export interface CreateUnitGroupDto {
  buildingId: string;
  name: string;
  description?: string;
  unitIds: string[];
}

export interface AddMemberDto {
  unitId: string;
}

@Controller('tenants/:tenantId/unit-groups')
@UseGuards(JwtAuthGuard)
export class UnitGroupController {
  constructor(private readonly unitGroupService: UnitGroupService) {}

  @Post()
  async createUnitGroup(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateUnitGroupDto,
  ) {
    const tenantId = req.tenantId || req.user?.tenantId;
    const membershipId = req.user?.membershipId;
    const roles = req.user?.roles ?? [];

    if (!tenantId || !membershipId) {
      throw new Error('Missing tenantId or membershipId in request');
    }

    return this.unitGroupService.createUnitGroup(
      tenantId,
      dto.buildingId,
      dto.name,
      dto.description,
      dto.unitIds,
      membershipId,
      roles,
    );
  }

  @Get(':groupId')
  async getUnitGroup(
    @Request() req: AuthenticatedRequest,
    @Param('groupId') groupId: string,
  ) {
    const tenantId = req.tenantId || req.user?.tenantId;
    const roles = req.user?.roles ?? [];

    if (!tenantId) {
      throw new Error('Missing tenantId in request');
    }

    return this.unitGroupService.getUnitGroup(tenantId, groupId, roles);
  }

  @Get()
  async listUnitGroups(
    @Request() req: AuthenticatedRequest,
    @Query('buildingId') buildingId?: string,
  ) {
    const tenantId = req.tenantId || req.user?.tenantId;
    const roles = req.user?.roles ?? [];

    if (!tenantId) {
      throw new Error('Missing tenantId in request');
    }

    return this.unitGroupService.listUnitGroups(tenantId, buildingId, roles);
  }

  @Post(':groupId/members')
  async addMember(
    @Request() req: AuthenticatedRequest,
    @Param('groupId') groupId: string,
    @Body() dto: AddMemberDto,
  ) {
    const tenantId = req.tenantId || req.user?.tenantId;
    const membershipId = req.user?.membershipId;
    const roles = req.user?.roles ?? [];

    if (!tenantId || !membershipId) {
      throw new Error('Missing tenantId or membershipId in request');
    }

    await this.unitGroupService.addMember(
      tenantId,
      groupId,
      dto.unitId,
      membershipId,
      roles,
    );
    return { success: true };
  }

  @Delete(':groupId/members/:unitId')
  async removeMember(
    @Request() req: AuthenticatedRequest,
    @Param('groupId') groupId: string,
    @Param('unitId') unitId: string,
  ) {
    const tenantId = req.tenantId || req.user?.tenantId;
    const membershipId = req.user?.membershipId;
    const roles = req.user?.roles ?? [];

    if (!tenantId || !membershipId) {
      throw new Error('Missing tenantId or membershipId in request');
    }

    await this.unitGroupService.removeMember(
      tenantId,
      groupId,
      unitId,
      membershipId,
      roles,
    );
    return { success: true };
  }

  @Delete(':groupId')
  async deleteUnitGroup(
    @Request() req: AuthenticatedRequest,
    @Param('groupId') groupId: string,
  ) {
    const tenantId = req.tenantId || req.user?.tenantId;
    const membershipId = req.user?.membershipId;
    const roles = req.user?.roles ?? [];

    if (!tenantId || !membershipId) {
      throw new Error('Missing tenantId or membershipId in request');
    }

    await this.unitGroupService.deleteUnitGroup(
      tenantId,
      groupId,
      membershipId,
      roles,
    );
    return { success: true };
  }
}
