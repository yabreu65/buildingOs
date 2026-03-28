import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '../config/config.service';
import { EmailType } from '../email/email.types';
import { CreateTenantMemberDto, UpdateTenantMemberDto, InviteTenantMemberDto } from './dto';
import { AuditAction, MemberStatus, Role, TenantMember } from '@prisma/client';
import * as crypto from 'crypto';

export interface AssignableResidentDto {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role: Role;
  status: MemberStatus;
  assignedUnits: number;
  isPrimaryIn: string[];
}

@Injectable()
export class TenantMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Create a new tenant member (starts in DRAFT status)
   */
  async createMember(
    tenantId: string,
    dto: CreateTenantMemberDto,
    actorId: string,
  ) {
    // Validate unique email
    if (dto.email) {
      const existing = await this.prisma.tenantMember.findUnique({
        where: { tenantId_email: { tenantId, email: dto.email } },
      });
      if (existing) {
        throw new ConflictException('Email already in use in this tenant');
      }
    }

    // Validate unique phone
    if (dto.phone) {
      const existing = await this.prisma.tenantMember.findUnique({
        where: { tenantId_phone: { tenantId, phone: dto.phone } },
      });
      if (existing) {
        throw new ConflictException('Phone already in use in this tenant');
      }
    }

    const member = await this.prisma.tenantMember.create({
      data: {
        tenantId,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        role: dto.role as Role || Role.RESIDENT,
        status: MemberStatus.DRAFT,
        notes: dto.notes,
      },
    });

    // Audit
    void this.audit.createLog({
      tenantId,
      actorUserId: actorId,
      action: AuditAction.TENANT_MEMBER_CREATE,
      entityType: 'TenantMember',
      entityId: member.id,
      metadata: {
        name: member.name,
        email: member.email,
        role: member.role,
      },
    });

    return member;
  }

  /**
   * Update tenant member
   * If email/phone is added to DRAFT → auto-transition to PENDING_INVITE
   */
  async updateMember(
    tenantId: string,
    memberId: string,
    dto: UpdateTenantMemberDto,
    actorId: string,
  ) {
    const member = await this.prisma.tenantMember.findUnique({
      where: { id: memberId },
    });

    if (!member || member.tenantId !== tenantId) {
      throw new NotFoundException('Member not found');
    }

    // Validate unique email (if changing)
    if (dto.email && dto.email !== member.email) {
      const existing = await this.prisma.tenantMember.findUnique({
        where: { tenantId_email: { tenantId, email: dto.email } },
      });
      if (existing) {
        throw new ConflictException('Email already in use in this tenant');
      }
    }

    // Validate unique phone (if changing)
    if (dto.phone && dto.phone !== member.phone) {
      const existing = await this.prisma.tenantMember.findUnique({
        where: { tenantId_phone: { tenantId, phone: dto.phone } },
      });
      if (existing) {
        throw new ConflictException('Phone already in use in this tenant');
      }
    }

    // Logic: if adding email/phone to DRAFT → PENDING_INVITE
    let newStatus = member.status;
    if (member.status === MemberStatus.DRAFT) {
      const hasContact = (dto.email || member.email) && (dto.phone || member.phone);
      if (hasContact) {
        newStatus = MemberStatus.PENDING_INVITE;
      }
    }

    const updated = await this.prisma.tenantMember.update({
      where: { id: memberId },
      data: {
        name: dto.name ?? undefined,
        email: dto.email ?? undefined,
        phone: dto.phone ?? undefined,
        notes: dto.notes ?? undefined,
        status: newStatus,
      },
    });

    // Audit
    void this.audit.createLog({
      tenantId,
      actorUserId: actorId,
      action: AuditAction.TENANT_MEMBER_UPDATE,
      entityType: 'TenantMember',
      entityId: memberId,
      metadata: { changes: dto },
    });

    return updated;
  }

  /**
   * Invite a member (requires email or phone)
   */
  async inviteMember(
    tenantId: string,
    memberId: string,
    dto: InviteTenantMemberDto,
    actorId: string,
  ) {
    const member = await this.prisma.tenantMember.findUnique({
      where: { id: memberId },
    });

    if (!member || member.tenantId !== tenantId) {
      throw new NotFoundException('Member not found');
    }

    if (!member.email && !member.phone) {
      throw new BadRequestException(
        'Member must have email or phone to invite',
      );
    }

    if (member.status === MemberStatus.ACTIVE) {
      throw new BadRequestException('Member is already active');
    }

    if (!member.email) {
      throw new BadRequestException('Member must have email to send invitation');
    }

    // Check attempt limit using Invitation table
    const recentInvites = await this.prisma.invitation.count({
      where: {
        tenantId,
        email: member.email,
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days
        },
      },
    });

    if (recentInvites >= 3 && !dto.force) {
      throw new BadRequestException('Too many invitations. Require admin force.');
    }

    // Delete all previous invitations for this email in this tenant (avoid unique constraint)
    await this.prisma.invitation.deleteMany({
      where: { tenantId, email: member.email },
    });

    // Look up actor's membership for audit
    const actorMembership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId: actorId, tenantId } },
    });

    // Generate token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Create invitation in the standard Invitation table (reuses validate/accept flow)
    const invitation = await this.prisma.invitation.create({
      data: {
        tenantId,
        email: member.email,
        tokenHash,
        roles: ['RESIDENT'],
        invitedByMembershipId: actorMembership?.id ?? actorId,
        expiresAt,
        status: 'PENDING',
      },
    });

    // Update TenantMember status to PENDING_INVITE
    await this.prisma.tenantMember.update({
      where: { id: memberId },
      data: { status: MemberStatus.PENDING_INVITE },
    });

    // Audit
    void this.audit.createLog({
      tenantId,
      actorMembershipId: actorMembership?.id ?? actorId,
      action: AuditAction.TENANT_MEMBER_INVITED,
      entityType: 'Invitation',
      entityId: invitation.id,
      metadata: { memberId, email: member.email },
    });

    // Send invitation email (fire-and-forget)
    void this.sendInvitationEmail(member.email, member.name, token, tenantId);

    return { id: invitation.id, token, expiresAt };
  }

  /**
   * Send invitation email to member
   */
  private async sendInvitationEmail(
    email: string,
    name: string,
    token: string,
    tenantId: string,
  ): Promise<void> {
    const appBaseUrl = this.configService.getValue('appBaseUrl') as string;
    const inviteLink = `${appBaseUrl}/invite?token=${token}`;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, brandName: true },
    });
    const tenantName = tenant?.brandName || tenant?.name || 'BuildingOS';

    const htmlBody = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #2563eb;">Has sido invitado a ${tenantName}</h2>
        <p>Hola <strong>${name}</strong>,</p>
        <p>Fuiste invitado a unirte como residente en <strong>${tenantName}</strong>.</p>
        <p>Hacé click en el botón para aceptar tu invitación y crear tu cuenta:</p>
        <p>
          <a href="${inviteLink}" style="background-color: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">
            Aceptar Invitación
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">Esta invitación expira en 7 días.</p>
        <p style="color: #999; font-size: 12px;">Si no esperabas este email, podés ignorarlo.</p>
      </div>
    `;

    await this.emailService.sendEmail(
      {
        to: email,
        subject: `Invitación a ${tenantName}`,
        htmlBody,
        tenantId,
      },
      EmailType.INVITATION,
    );
  }

  /**
   * Get members assignable to units (not DISABLED, status is DRAFT/PENDING/ACTIVE)
   */
  async getAssignableResidents(
    tenantId: string,
    unitId?: string,
  ): Promise<AssignableResidentDto[]> {
    const members = await this.prisma.tenantMember.findMany({
      where: {
        tenantId,
        status: {
          in: [MemberStatus.DRAFT, MemberStatus.PENDING_INVITE, MemberStatus.ACTIVE],
        },
        role: {
          in: [Role.RESIDENT, Role.OPERATOR],
        },
      },
      include: {
        occupancies: {
          where: { endDate: null },
          select: { id: true, isPrimary: true, unitId: true },
        },
      },
    });

    return members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email || undefined,
      phone: m.phone || undefined,
      role: m.role,
      status: m.status,
      assignedUnits: m.occupancies.length,
      isPrimaryIn: m.occupancies
        .filter((o) => o.isPrimary)
        .map((o) => o.unitId),
    }));
  }

  /**
   * Get member by ID
   */
  async getMember(tenantId: string, memberId: string) {
    const member = await this.prisma.tenantMember.findUnique({
      where: { id: memberId },
    });

    if (!member || member.tenantId !== tenantId) {
      throw new NotFoundException('Member not found');
    }

    return member;
  }

  /**
   * List members in tenant
   */
  async listMembers(tenantId: string, status?: MemberStatus) {
    return this.prisma.tenantMember.findMany({
      where: {
        tenantId,
        status: status ? status : undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Delete a tenant member (only DRAFT or PENDING_INVITE)
   */
  async deleteMember(tenantId: string, memberId: string, actorId?: string): Promise<TenantMember> {
    const member = await this.prisma.tenantMember.findUnique({
      where: { id: memberId },
    });

    if (!member || member.tenantId !== tenantId) {
      throw new NotFoundException('Member not found');
    }

    // Only allow deletion of DRAFT or PENDING_INVITE members
    if (member.status !== MemberStatus.DRAFT && member.status !== MemberStatus.PENDING_INVITE) {
      throw new BadRequestException(
        'Can only delete members in DRAFT or PENDING_INVITE status',
      );
    }

    const deleted = await this.prisma.tenantMember.delete({
      where: { id: memberId },
    });

    // Audit
    void this.audit.createLog({
      tenantId,
      actorUserId: actorId,
      action: AuditAction.TENANT_MEMBER_DELETE,
      entityType: 'TenantMember',
      entityId: memberId,
      metadata: {
        name: member.name,
        email: member.email,
        status: member.status,
      },
    });

    return deleted;
  }
}
