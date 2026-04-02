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
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { IsString, IsArray, IsOptional, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../common/types/request.types';
import { UnitGroupService } from './unit-group.service';

export class CreateUnitGroupDto {
  @IsString()
  buildingId!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  unitIds!: string[];
}

export class AddMemberDto {
  @IsString()
  unitId!: string;
}

@Controller('tenants/:tenantId/unit-groups')
@UseGuards(JwtAuthGuard)
export class UnitGroupController {
  constructor(private readonly unitGroupService: UnitGroupService) {}

  /**
   * Create a new unit group within a building
   * @param req Authenticated request with tenantId and membershipId
   * @param dto Unit group creation data (name, description, unitIds)
   * @returns Created unit group with member count
   */
  @Post()
  async createUnitGroup(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateUnitGroupDto,
  ) {
    const tenantId = req.tenantId || req.user?.tenantId;
    const membershipId = req.user?.membershipId;
    const roles = req.user?.roles ?? [];

    if (!tenantId || !membershipId) {
      throw new UnauthorizedException('Missing tenantId or membershipId in request');
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

  /**
   * Retrieve a specific unit group with all members and their details
   * @param req Authenticated request with tenantId
   * @param groupId Unit group ID to retrieve
   * @returns Unit group with members including unit details (code, label, area)
   */
  @Get(':groupId')
  async getUnitGroup(
    @Request() req: AuthenticatedRequest,
    @Param('groupId') groupId: string,
  ) {
    const tenantId = req.tenantId || req.user?.tenantId;
    const roles = req.user?.roles ?? [];

    if (!tenantId) {
      throw new UnauthorizedException('Missing tenantId in request');
    }

    return this.unitGroupService.getUnitGroup(tenantId, groupId, roles);
  }

  /**
   * List unit groups for a tenant, optionally filtered by building
   * @param req Authenticated request with tenantId
   * @param buildingId Optional building ID to filter groups
   * @returns Array of unit groups with member counts
   */
  @Get()
  async listUnitGroups(
    @Request() req: AuthenticatedRequest,
    @Query('buildingId') buildingId?: string,
  ) {
    const tenantId = req.tenantId || req.user?.tenantId;
    const roles = req.user?.roles ?? [];

    if (!tenantId) {
      throw new UnauthorizedException('Missing tenantId in request');
    }

    return this.unitGroupService.listUnitGroups(tenantId, buildingId, roles);
  }

  /**
   * Add a unit to an existing unit group
   * @param req Authenticated request with tenantId and membershipId
   * @param groupId Unit group ID to add member to
   * @param dto Unit ID to add (unitId)
   * @returns Success status
   */
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
      throw new UnauthorizedException('Missing tenantId or membershipId in request');
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

  /**
   * Remove a unit from a unit group
   * @param req Authenticated request with tenantId and membershipId
   * @param groupId Unit group ID to remove member from
   * @param unitId Unit ID to remove
   * @returns Success status
   */
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
      throw new UnauthorizedException('Missing tenantId or membershipId in request');
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

  /**
   * Delete a unit group (only if not used in active movements)
   * @param req Authenticated request with tenantId and membershipId
   * @param groupId Unit group ID to delete
   * @returns Success status
   * @throws BadRequestException if group is used in active expenses/incomes
   */
  @Delete(':groupId')
  async deleteUnitGroup(
    @Request() req: AuthenticatedRequest,
    @Param('groupId') groupId: string,
  ) {
    const tenantId = req.tenantId || req.user?.tenantId;
    const membershipId = req.user?.membershipId;
    const roles = req.user?.roles ?? [];

    if (!tenantId || !membershipId) {
      throw new UnauthorizedException('Missing tenantId or membershipId in request');
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
