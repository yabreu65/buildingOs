import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { PlanEntitlementsService } from '../billing/plan-entitlements.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { AuditAction, InvitationStatus } from '@prisma/client';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

export interface AuthResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
  memberships: Array<{
    tenantId: string;
    roles: string[];
  }>;
}

@Injectable()
export class InvitationsService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private tenancyService: TenancyService,
    private auditService: AuditService,
    private planEntitlements: PlanEntitlementsService,
  ) {}

  /**
   * Create invitation with secure token
   * Only TENANT_ADMIN or TENANT_OWNER can invite
   * Validates plan limits before creating invitation
   */
  async createInvitation(
    tenantId: string,
    dto: CreateInvitationDto,
    actorMembershipId: string,
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

    // Check if already has PENDING invitation
    const existingPending = await this.prisma.invitation.findFirst({
      where: {
        tenantId,
        email: dto.email,
        status: InvitationStatus.PENDING,
      },
    });

    if (existingPending) {
      throw new ConflictException('Ya hay una invitación pendiente para este email');
    }

    // Generate secure token (64 char hex)
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Expiry: 7 days
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Create invitation
    const invitation = await this.prisma.invitation.create({
      data: {
        tenantId,
        email: dto.email,
        tokenHash,
        roles: dto.roles,
        invitedByMembershipId: actorMembershipId,
        expiresAt,
      },
    });

    // Log: MEMBERSHIP_INVITE_SENT
    void this.auditService.createLog({
      tenantId,
      actorMembershipId,
      action: AuditAction.MEMBERSHIP_INVITE_SENT,
      entityType: 'Invitation',
      entityId: invitation.id,
      metadata: {
        email: dto.email,
        roles: dto.roles,
      },
    });

    // STUB: Email would be sent here
    console.log(
      `[EMAIL STUB] Invitation link: http://localhost:3000/invite?token=${token}`,
    );

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
    email: string;
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
      email: invitation.email,
      expiresAt: invitation.expiresAt,
    };
  }

  /**
   * Accept invitation: create user (or link existing) + membership + roles
   * Returns AuthResponse with JWT
   */
  async acceptInvitation(dto: AcceptInvitationDto): Promise<AuthResponse> {
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
    const roles = invitation.roles as string[];

    // Transaction: find or create user + membership + roles
    const result = await this.prisma.$transaction(async (tx) => {
      // Find or create user
      let user = await tx.user.findUnique({
        where: { email },
      });

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
      }

      // Find or create membership
      let membership = await tx.membership.findUnique({
        where: { userId_tenantId: { userId: user.id, tenantId } },
      });

      if (membership) {
        // Already member: return conflict
        throw new ConflictException('Este usuario ya es miembro del tenant');
      }

      membership = await tx.membership.create({
        data: {
          userId: user.id,
          tenantId,
        },
      });

      // Create roles
      for (const role of roles) {
        await tx.membershipRole.create({
          data: {
            membershipId: membership.id,
            role: role as any, // Role enum is validated in DTO
          },
        });
      }

      // Mark invitation as accepted
      await tx.invitation.update({
        where: { id: invitation.id },
        data: {
          status: InvitationStatus.ACCEPTED,
          acceptedAt: new Date(),
        },
      });

      return { user, membership };
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

    return {
      accessToken: this.jwtService.sign({
        email: result.user.email,
        sub: result.user.id,
        isSuperAdmin: false,
      }),
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
      },
      memberships,
    };
  }

  /**
   * Revoke pending invitation
   */
  async revokeInvitation(
    tenantId: string,
    invitationId: string,
    actorMembershipId: string,
  ): Promise<void> {
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
        user: true,
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
      roles: inv.roles as string[],
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
    }));
  }
}
