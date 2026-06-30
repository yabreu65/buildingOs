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
import type { AuthenticatedRequest } from '../common/types/request.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import {
  MembershipsService,
  ScopedRoleResponse,
  AssignableResidentResponse,
  AssignableTicketMemberResponse,
} from './memberships.service';
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
   * GET /tenants/:tenantId/memberships/assignable-tickets
   * List active members eligible to be assigned to tickets
   */
  @Get('assignable-tickets')
  async getAssignableTicketMembers(
    @Param('tenantId') tenantId: string,
  ): Promise<AssignableTicketMemberResponse[]> {
    return this.membershipsService.getAssignableTicketMembers(tenantId);
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
    @Req() req: AuthenticatedRequest,
  ): Promise<ScopedRoleResponse> {
    const user = req.user;
    const memberships = user.memberships ?? [];

    // Get actor membership (current user's membership in this tenant)
    const actorMembership = memberships.find((membership) => membership.tenantId === tenantId);
    if (!actorMembership) {
      throw new BadRequestException('User not a member of this tenant');
    }
    if (!actorMembership.id) {
      throw new BadRequestException('User membership is invalid');
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
    @Req() req: AuthenticatedRequest,
  ): Promise<{ message: string }> {
    const user = req.user;
    const memberships = user.memberships ?? [];

    // Get actor membership (current user's membership in this tenant)
    const actorMembership = memberships.find((membership) => membership.tenantId === tenantId);
    if (!actorMembership) {
      throw new BadRequestException('User not a member of this tenant');
    }
    if (!actorMembership.id) {
      throw new BadRequestException('User membership is invalid');
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
