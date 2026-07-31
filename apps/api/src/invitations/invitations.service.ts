import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthService, AuthResponse as SessionAuthResponse } from '../auth/auth.service';
import { PlanEntitlementsService } from '../billing/plan-entitlements.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { AuditAction, InvitationStatus, Role, Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

function normalizeInvitationRoles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((role): role is string => typeof role === 'string');
}

function isInvitationRole(value: string): value is Role {
  return (
    value === Role.TENANT_ADMIN ||
    value === Role.OPERATOR ||
    value === Role.RESIDENT
  );
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancyService: TenancyService,
    private readonly auditService: AuditService,
    private readonly planEntitlements: PlanEntitlementsService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Create invitation with secure token
   * Only TENANT_ADMIN or TENANT_OWNER can invite
   * Validates plan limits before creating invitation
   */
  async createInvitation(
    tenantId: string,
    dto: CreateInvitationDto,
    actorUserId: string,
  ): Promise<{ id: string; email: string; expiresAt: Date }> {
    // Validate plan limits for users
    await this.planEntitlements.assertLimit(tenantId, 'users');

    // Validate roles (no SUPER_ADMIN, no TENANT_OWNER from here)
    const allowedRoles = ['TENANT_ADMIN', 'OPERATOR', 'RESIDENT'];
    const invalidRoles = dto.roles.filter((r) => !allowedRoles.includes(r));
    if (invalidRoles.length > 0) {
      throw new BadRequestException(
        `Invalid roles: ${invalidRoles.join(', ')}. Allowed: ${allowedRoles.join(', ')}`,
      );
    }

    // Generate secure token (64 char hex)
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Expiry: 7 days
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const invitation = await this.prisma.$transaction(async (tx) => {
      const actorMembership = await tx.membership.findUnique({
        where: { userId_tenantId: { userId: actorUserId, tenantId } },
        select: { id: true },
      });

      if (!actorMembership) {
        throw new NotFoundException('Membership not found');
      }

      try {
        return await tx.invitation.create({
          data: {
            tenantId,
            email: dto.email,
            tokenHash,
            roles: dto.roles,
            invitedByMembershipId: actorMembership.id,
            expiresAt,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(
            'Ya hay una invitación pendiente para este email',
          );
        }
        throw error;
      }
    });

    // Log: MEMBERSHIP_INVITE_SENT
    void this.auditService.createLog({
      tenantId,
      actorMembershipId: invitation.invitedByMembershipId,
      action: AuditAction.MEMBERSHIP_INVITE_SENT,
      entityType: 'Invitation',
      entityId: invitation.id,
      metadata: {
        email: dto.email,
        roles: dto.roles,
      },
    });

    this.logger.log(`Invitation created for ${dto.email}`);

    return {
      id: invitation.id,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
    };
  }

  /**
   * Validate token and return invitation details
   * Returns 404 for invalid/expired/revoked tokens (prevent enumeration)
   */
  async validateToken(
    token: string,
  ): Promise<{
    tenantId: string;
    tenantName: string;
    email: string;
    roles: string[];
    expiresAt: Date;
  }> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const invitation = await this.prisma.invitation.findFirst({
      where: { tokenHash },
      include: {
        tenant: true,
      },
    });

    // Not found
    if (!invitation) {
      throw new NotFoundException('Invitación inválida o expirada');
    }

    // Already processed
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new NotFoundException('Invitación inválida o expirada');
    }

    // Expired
    if (invitation.expiresAt < new Date()) {
      // Auto-mark as expired
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.EXPIRED },
      });
      throw new NotFoundException('Invitación inválida o expirada');
    }

    return {
      tenantId: invitation.tenantId,
      tenantName: invitation.tenant.name,
      email: invitation.email,
      roles: normalizeInvitationRoles(invitation.roles),
      expiresAt: invitation.expiresAt,
    };
  }

  /**
   * Accept invitation: create user (or link existing) + membership + roles
   * Idempotent: allows accepting even if membership already exists
   * Returns session auth response with cookie-ready tokens and metadata about creation
   */
  async acceptInvitation(dto: AcceptInvitationDto): Promise<SessionAuthResponse & { membershipExisted?: boolean; userExisted?: boolean }> {
    const tokenHash = crypto.createHash('sha256').update(dto.token).digest('hex');

    const invitation = await this.prisma.invitation.findFirst({
      where: { tokenHash },
    });

    if (!invitation || invitation.status !== InvitationStatus.PENDING) {
      throw new NotFoundException('Invitación inválida o expirada');
    }

    if (invitation.expiresAt < new Date()) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.EXPIRED },
      });
      throw new NotFoundException('Invitación inválida o expirada');
    }

    const { tenantId, email } = invitation;
    const roles = normalizeInvitationRoles(invitation.roles);

    // Transaction: find or create user + membership + roles
    const result = await this.prisma.$transaction(async (tx) => {
      // Find or create user
      let user = await tx.user.findUnique({
        where: { email },
      });

      const userExisted = !!user;

      if (!user) {
        // New user: require name and password
        if (!dto.name || dto.name.length < 1) {
          throw new BadRequestException('Nombre requerido para nuevo usuario');
        }
        if (!dto.password || dto.password.length < 8) {
          throw new BadRequestException(
            'Contraseña requerida y debe tener al menos 8 caracteres',
          );
        }

        const hashedPassword = await bcrypt.hash(dto.password, 10);
        user = await tx.user.create({
          data: {
            email,
            name: dto.name,
            passwordHash: hashedPassword,
          },
        });
      } else {
        // Existing user: allow setting password if empty (idempotent)
        if (dto.password && dto.password.length >= 8 && !user.passwordHash) {
          const hashedPassword = await bcrypt.hash(dto.password, 10);
          user = await tx.user.update({
            where: { id: user.id },
            data: { passwordHash: hashedPassword },
          });
        }
      }

      // Find or create membership (idempotent: allow if exists)
      let membership = await tx.membership.findUnique({
        where: { userId_tenantId: { userId: user.id, tenantId } },
      });

      const membershipExisted = !!membership;

      if (!membership) {
        // Create new membership
        membership = await tx.membership.create({
          data: {
            userId: user.id,
            tenantId,
          },
        });

        // Create roles (only for new membership)
        for (const role of roles) {
          if (!isInvitationRole(role)) {
            throw new BadRequestException(`Invalid role in invitation: ${role}`);
          }
          await tx.membershipRole.create({
            data: {
              tenantId,
              membershipId: membership.id,
              role,
            },
          });
        }
      }

      // Clear any previous ACCEPTED records for same email+tenant to avoid unique constraint
      await tx.invitation.updateMany({
        where: { tenantId, email, status: InvitationStatus.ACCEPTED },
        data: { status: InvitationStatus.REVOKED },
      });

      // Mark invitation as accepted
      await tx.invitation.update({
        where: { id: invitation.id },
        data: {
          status: InvitationStatus.ACCEPTED,
          acceptedAt: new Date(),
        },
      });

      // If RESIDENT invitation, link TenantMember to the new user and mark ACTIVE
      if (roles.includes('RESIDENT')) {
        const tenantMember = await tx.tenantMember.findFirst({
          where: { tenantId, email },
        });
        if (tenantMember) {
          await tx.tenantMember.update({
            where: { id: tenantMember.id },
            data: { userId: user.id, status: 'ACTIVE' },
          });
        }
      }

      return { user, membership, membershipExisted, userExisted };
    });

    // Get memberships for JWT payload
    const memberships = await this.tenancyService.getMembershipsForUser(
      result.user.id,
    );

    // Log: MEMBERSHIP_INVITE_ACCEPTED
    void this.auditService.createLog({
      tenantId,
      actorUserId: result.user.id,
      actorMembershipId: result.membership.id,
      action: AuditAction.MEMBERSHIP_INVITE_ACCEPTED,
      entityType: 'Invitation',
      entityId: invitation.id,
      metadata: {
        email: result.user.email,
        roles,
      },
    });

    const session = await this.authService.createAuthResponse({
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
      },
      memberships,
      isSuperAdmin: false,
      sessionContext: {
        userAgent: null,
        ipAddress: null,
      },
    });

    return {
      ...session,
      membershipExisted: result.membershipExisted,
      userExisted: result.userExisted,
    };
  }

  /**
   * Revoke pending invitation
   */
  async revokeInvitation(
    tenantId: string,
    invitationId: string,
    actorUserId: string,
  ): Promise<void> {
    const actorMembershipId = await this.getActorMembershipId(
      tenantId,
      actorUserId,
    );

    const invitation = await this.prisma.invitation.findFirst({
      where: {
        id: invitationId,
        tenantId,
        status: InvitationStatus.PENDING,
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitación no encontrada o ya procesada');
    }

    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: InvitationStatus.REVOKED },
    });

    // Log: MEMBERSHIP_INVITE_REVOKED
    void this.auditService.createLog({
      tenantId,
      actorMembershipId,
      action: AuditAction.MEMBERSHIP_INVITE_REVOKED,
      entityType: 'Invitation',
      entityId: invitation.id,
      metadata: {
        email: invitation.email,
      },
    });
  }

  /**
   * List members in a tenant
   */
  async listMembers(tenantId: string): Promise<
    Array<{
      id: string;
      email: string;
      name: string;
      createdAt: Date;
      roles: string[];
    }>
  > {
    const memberships = await this.prisma.membership.findMany({
      where: { tenantId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        roles: true,
      },
    });

    return memberships.map((m) => ({
      id: m.user.id,
      email: m.user.email,
      name: m.user.name,
      createdAt: m.createdAt,
      roles: m.roles.map((r) => r.role),
    }));
  }

  /**
   * List pending invitations in a tenant
   */
  async listInvitations(tenantId: string): Promise<
    Array<{
      id: string;
      email: string;
      roles: string[];
      expiresAt: Date;
      createdAt: Date;
    }>
  > {
    const invitations = await this.prisma.invitation.findMany({
      where: {
        tenantId,
        status: InvitationStatus.PENDING,
      },
    });

    return invitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      roles: normalizeInvitationRoles(inv.roles),
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
    }));
  }

  /**
   * Resend invitation: revoke old token and generate new one
   * Only works if invitation is still PENDING
   * Creates new token, invalidates old, audits as MEMBERSHIP_INVITE_RESENT
   */
  async resendInvitation(
    tenantId: string,
    invitationId: string,
    actorUserId: string,
  ): Promise<{ id: string; email: string; expiresAt: Date }> {
    const actorMembershipId = await this.getActorMembershipId(
      tenantId,
      actorUserId,
    );

    // Fetch existing invitation
    const invitation = await this.prisma.invitation.findFirst({
      where: {
        id: invitationId,
        tenantId,
        status: InvitationStatus.PENDING,
      },
    });

    if (!invitation) {
      throw new NotFoundException(
        'Invitación no encontrada o ya fue procesada',
      );
    }

    // Generate new token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // New expiry: 7 days from now
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Update invitation with new token and expiry
    const updated = await this.prisma.invitation.update({
      where: { id: invitationId },
      data: {
        tokenHash,
        expiresAt,
      },
    });

    // Log: MEMBERSHIP_INVITE_RESENT
    void this.auditService.createLog({
      tenantId,
      actorMembershipId,
      action: AuditAction.MEMBERSHIP_INVITE_RESENT,
      entityType: 'Invitation',
      entityId: invitationId,
      metadata: {
        email: updated.email,
        oldExpiresAt: invitation.expiresAt,
        newExpiresAt: expiresAt,
      },
    });

    this.logger.log(`Invitation resent for ${updated.email}`);

    return {
      id: updated.id,
      email: updated.email,
      expiresAt: updated.expiresAt,
    };
  }

  private async getActorMembershipId(
    tenantId: string,
    userId: string,
  ): Promise<string> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      select: { id: true },
    });

    if (!membership) {
      throw new ForbiddenException('Você não é membro deste tenant');
    }

    return membership.id;
  }

  /**
   * Background job: mark all expired invitations as EXPIRED
   * Called periodically (every 5 minutes) to clean up stale invitations
   * Logs MEMBERSHIP_INVITE_EXPIRED for each expired invitation
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async markExpiredInvitations(): Promise<number> {
    const now = new Date();

    // Find all PENDING invitations that have expired
    const expiredInvitations = await this.prisma.invitation.findMany({
      where: {
        status: InvitationStatus.PENDING,
        expiresAt: {
          lt: now, // less than now = expired
        },
      },
    });

    if (expiredInvitations.length === 0) {
      return 0;
    }

    // Update all to EXPIRED status
    await this.prisma.invitation.updateMany({
      where: {
        status: InvitationStatus.PENDING,
        expiresAt: {
          lt: now,
        },
      },
      data: {
        status: InvitationStatus.EXPIRED,
      },
    });

    // Log each expiration (fire-and-forget)
    for (const inv of expiredInvitations) {
      void this.auditService.createLog({
        tenantId: inv.tenantId,
        action: AuditAction.MEMBERSHIP_INVITE_EXPIRED,
        entityType: 'Invitation',
        entityId: inv.id,
        metadata: {
          email: inv.email,
          expiredAt: now,
          originalExpiresAt: inv.expiresAt,
        },
      });
    }

    this.logger.log(`Marked ${expiredInvitations.length} invitations as EXPIRED`);
    return expiredInvitations.length;
  }
}
