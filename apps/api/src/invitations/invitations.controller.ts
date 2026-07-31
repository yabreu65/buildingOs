import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Request,
  BadRequestException,
  Res,
} from '@nestjs/common';
import type { Request as ExpressRequest, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { TenantParam } from '../tenancy/tenant-param.decorator';
import { RequireTenantPermission } from '../rbac/tenant-permission.guard';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { ValidateInvitationQueryDto } from './dto/validate-invitation-query.dto';
import { setAuthCookies } from '../auth/auth.cookies';

export interface RequestWithUser extends ExpressRequest {
  user: {
    id: string;
    email: string;
    name: string;
  };
  tenantId?: string;
}

// ============================================================================
// Public endpoints (no auth required)
// ============================================================================

@Controller('invitations')
export class InvitationsPublicController {
  constructor(private readonly invitationsService: InvitationsService) {}

  /**
   * GET /invitations/validate?token=...
   * Public endpoint to validate invitation token
   */
  @Get('validate')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async validateToken(@Query() query: ValidateInvitationQueryDto) {
    return this.invitationsService.validateToken(query.token);
  }

  /**
   * POST /invitations/accept
   * Public endpoint to accept invitation
   */
  @Post('accept')
  async acceptInvitation(
    @Body() dto: AcceptInvitationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const response = await this.invitationsService.acceptInvitation(dto);
    setAuthCookies(res, response.accessToken, response.refreshToken);
    return {
      user: response.user,
      memberships: response.memberships,
      membershipExisted: response.membershipExisted,
      userExisted: response.userExisted,
    };
  }
}

// ============================================================================
// Protected endpoints (require JWT + TenantAccess)
// ============================================================================

@Controller('tenants/:tenantId/memberships')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class InvitationsAdminController {
  constructor(private readonly invitationsService: InvitationsService) {}

  /**
   * GET /tenants/:tenantId/memberships
   * List active members in tenant
   */
  @Get()
  @RequireTenantPermission('members.manage')
  async listMembers(@TenantParam() tenantId: string) {
    return this.invitationsService.listMembers(tenantId);
  }

  /**
   * GET /tenants/:tenantId/memberships/invitations
   * List pending invitations in tenant
   */
  @Get('invitations')
  @RequireTenantPermission('members.manage')
  async listInvitations(@TenantParam() tenantId: string) {
    return this.invitationsService.listInvitations(tenantId);
  }

  /**
   * POST /tenants/:tenantId/memberships/invitations
   * Create new invitation (TENANT_ADMIN or TENANT_OWNER only)
   */
  @Post('invitations')
  @RequireTenantPermission('members.manage')
  async createInvitation(
    @TenantParam() tenantId: string,
    @Body() dto: CreateInvitationDto,
    @Request() req: RequestWithUser,
  ) {
    return this.invitationsService.createInvitation(tenantId, dto, req.user.id);
  }

  /**
   * DELETE /tenants/:tenantId/memberships/invitations/:id
   * Revoke pending invitation
   */
  @Delete('invitations/:id')
  @RequireTenantPermission('members.manage')
  async revokeInvitation(
    @TenantParam() tenantId: string,
    @Param('id') invitationId: string,
    @Request() req: RequestWithUser,
  ) {
    await this.invitationsService.revokeInvitation(tenantId, invitationId, req.user.id);

    return { success: true };
  }

  /**
   * POST /tenants/:tenantId/memberships/invitations/:id/resend
   * Resend pending invitation with new token
   */
  @Post('invitations/:id/resend')
  @RequireTenantPermission('members.manage')
  async resendInvitation(
    @TenantParam() tenantId: string,
    @Param('id') invitationId: string,
    @Request() req: RequestWithUser,
  ) {
    return this.invitationsService.resendInvitation(tenantId, invitationId, req.user.id);
  }
}
