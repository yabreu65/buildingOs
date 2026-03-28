import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { MembershipsService, ScopedRoleResponse, AssignableResidentResponse } from './memberships.service';
import { AddRoleDto } from './dto/add-role.dto';

@Controller('tenants/:tenantId/memberships')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  /**
   * GET /tenants/:tenantId/memberships/assignable-residents
   * List members who can be assigned as residents (non-admin users)
   */
  @Get('assignable-residents')
  async getAssignableResidents(
    @Param('tenantId') tenantId: string,
  ): Promise<AssignableResidentResponse[]> {
    return this.membershipsService.getAssignableResidents(tenantId);
  }

  /**
   * GET /tenants/:tenantId/memberships/:membershipId/roles
   * List all roles for a membership with scope information
   */
  @Get(':membershipId/roles')
  async getRoles(
    @Param('tenantId') tenantId: string,
    @Param('membershipId') membershipId: string,
  ): Promise<ScopedRoleResponse[]> {
    return this.membershipsService.getRoles(tenantId, membershipId);
  }

  /**
   * POST /tenants/:tenantId/memberships/:membershipId/roles
   * Add a scoped role to a membership
   */
  @Post(':membershipId/roles')
  async addRole(
    @Param('tenantId') tenantId: string,
    @Param('membershipId') membershipId: string,
    @Body() dto: AddRoleDto,
    @Req() req: Request & { user: any },
  ): Promise<ScopedRoleResponse> {
    const user = req.user;

    // Get actor membership (current user's membership in this tenant)
    const actorMembership = user.memberships.find((m: any) => m.tenantId === tenantId);
    if (!actorMembership) {
      throw new BadRequestException('User not a member of this tenant');
    }

    return this.membershipsService.addRole(
      tenantId,
      membershipId,
      actorMembership.id,
      dto,
    );
  }

  /**
   * DELETE /tenants/:tenantId/memberships/:membershipId/roles/:roleId
   * Remove a role from a membership
   */
  @Delete(':membershipId/roles/:roleId')
  async removeRole(
    @Param('tenantId') tenantId: string,
    @Param('membershipId') membershipId: string,
    @Param('roleId') roleId: string,
    @Req() req: Request & { user: any },
  ): Promise<{ message: string }> {
    const user = req.user;

    // Get actor membership (current user's membership in this tenant)
    const actorMembership = user.memberships.find((m: any) => m.tenantId === tenantId);
    if (!actorMembership) {
      throw new BadRequestException('User not a member of this tenant');
    }

    await this.membershipsService.removeRole(
      tenantId,
      membershipId,
      roleId,
      actorMembership.id,
    );

    return { message: 'Role removed successfully' };
  }
}
