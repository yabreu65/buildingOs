import {
  Controller,
  Post,
  Patch,
  Delete,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { TenantParam } from '../tenancy/tenant-param.decorator';
import { RequireTenantPermission } from '../rbac/tenant-permission.guard';
import { TenantMembersService } from './tenant-members.service';
import {
  CreateTenantMemberDto,
  UpdateTenantMemberDto,
  InviteTenantMemberDto,
  ListTenantMembersQueryDto,
  AssignableResidentsQueryDto,
} from './dto';

export interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
    name: string;
  };
}

@Controller('tenants/:tenantId/members')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class TenantMembersController {
  constructor(private readonly tenantMembersService: TenantMembersService) {}

  /**
   * Create a new tenant member (starts in DRAFT status)
   */
  @Post()
  @RequireTenantPermission('members.manage')
  create(
    @TenantParam() tenantId: string,
    @Body() dto: CreateTenantMemberDto,
    @Req() req: RequestWithUser,
  ) {
    return this.tenantMembersService.createMember(tenantId, dto, req.user.id);
  }

  /**
   * Update tenant member details
   * If email/phone is added to DRAFT → auto-transition to PENDING_INVITE
   */
  @Patch(':memberId')
  @RequireTenantPermission('members.manage')
  update(
    @TenantParam() tenantId: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateTenantMemberDto,
    @Req() req: RequestWithUser,
  ) {
    return this.tenantMembersService.updateMember(
      tenantId,
      memberId,
      dto,
      req.user.id,
    );
  }

  /**
   * Send invitation to member (requires email or phone)
   * Generates token and updates status to PENDING_INVITE
   */
  @Post(':memberId/invite')
  @RequireTenantPermission('members.manage')
  invite(
    @TenantParam() tenantId: string,
    @Param('memberId') memberId: string,
    @Body() dto: InviteTenantMemberDto,
    @Req() req: RequestWithUser,
  ) {
    return this.tenantMembersService.inviteMember(
      tenantId,
      memberId,
      dto,
      req.user.id,
    );
  }

  /**
   * Delete a tenant member (only DRAFT or PENDING_INVITE)
   */
  @Delete(':memberId')
  @RequireTenantPermission('members.manage')
  delete(
    @TenantParam() tenantId: string,
    @Param('memberId') memberId: string,
    @Req() req: RequestWithUser,
  ) {
    return this.tenantMembersService.deleteMember(tenantId, memberId, req.user.id);
  }

  /**
   * Get members assignable to units (not DISABLED, status is DRAFT/PENDING/ACTIVE)
   * Includes occupancy metadata (assigned unit count, primary assignments)
   */
  @Get('assignable')
  @RequireTenantPermission('members.manage')
  getAssignableResidents(
    @TenantParam() tenantId: string,
    @Query() query: AssignableResidentsQueryDto,
  ) {
    return this.tenantMembersService.getAssignableResidents(tenantId, query.unitId);
  }

  /**
   * Get single member by ID
   */
  @Get(':memberId')
  @RequireTenantPermission('members.manage')
  getMember(
    @TenantParam() tenantId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.tenantMembersService.getMember(tenantId, memberId);
  }

  /**
   * List all members in tenant with optional status filter
   */
  @Get()
  @RequireTenantPermission('members.manage')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  listMembers(
    @TenantParam() tenantId: string,
    @Query() query: ListTenantMembersQueryDto,
  ) {
    return this.tenantMembersService.listMembers(tenantId, query.status);
  }
}
