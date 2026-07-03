import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  BadRequestException,
  ForbiddenException,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { TenantParam } from '../tenancy/tenant-param.decorator';
import { RequireTenantPermission } from '../rbac/tenant-permission.guard';
import { PrismaService } from '../prisma/prisma.service';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { setAuthCookies } from '../auth/auth.cookies';

export interface RequestWithUser extends Request {
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
  async validateToken(@Query('token') token: string) {
    if (!token) {
      throw new BadRequestException('Token requerido');
    }
    return this.invitationsService.validateToken(token);
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
  constructor(
    private readonly invitationsService: InvitationsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * GET /tenants/:tenantId/memberships
   * List active members in tenant
   */
  @Get()
  async listMembers(@TenantParam() tenantId: string) {
    return this.invitationsService.listMembers(tenantId);
  }

  /**
   * GET /tenants/:tenantId/memberships/invitations
   * List pending invitations in tenant
   */
  @Get('invitations')
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
    // Get the user's membership in this tenant to pass actorMembershipId
    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId: req.user.id, tenantId } },
    });

    if (!membership) {
      throw new ForbiddenException('Você não é membro deste tenant');
    }

    return this.invitationsService.createInvitation(
      tenantId,
      dto,
      membership.id,
    );
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
    // Get actor membership
    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId: req.user.id, tenantId } },
    });

    if (!membership) {
      throw new ForbiddenException('Você não é membro deste tenant');
    }

    await this.invitationsService.revokeInvitation(
      tenantId,
      invitationId,
      membership.id,
    );

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
    // Get actor membership
    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId: req.user.id, tenantId } },
    });

    if (!membership) {
      throw new ForbiddenException('Você não é membro deste tenant');
    }

    return this.invitationsService.resendInvitation(
      tenantId,
      invitationId,
      membership.id,
    );
  }
}
