import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, MemberStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedMembership, AuthenticatedRequest } from '../common/types/request.types';
import { UpdateProfileDto } from './dto/update-profile.dto';

const tenantMemberProfileSelect = Prisma.validator<Prisma.TenantMemberDefaultArgs>()({
  select: {
    id: true,
    tenantId: true,
    userId: true,
    disabledAt: true,
    name: true,
    phone: true,
    role: true,
    status: true,
    createdAt: true,
    updatedAt: true,
  },
});

type TenantMemberProfileRecord = Prisma.TenantMemberGetPayload<typeof tenantMemberProfileSelect>;

export interface ProfileResponse {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly role: Role;
  readonly status: MemberStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async getMyProfile(req: AuthenticatedRequest): Promise<ProfileResponse> {
    const tenantId = this.resolveTenantId(req);
    const userId = this.resolveUserId(req);
    const email = this.resolveUserEmail(req);
    this.assertResidentMembership(req, tenantId);

    const member = await this.findTenantMember(tenantId, userId);
    if (!member) {
      throw new NotFoundException('Tenant member not found');
    }

    return this.toProfileResponse(member, email);
  }

  async updateMyProfile(
    req: AuthenticatedRequest,
    dto: UpdateProfileDto,
  ): Promise<ProfileResponse> {
    const tenantId = this.resolveTenantId(req);
    const userId = this.resolveUserId(req);
    const email = this.resolveUserEmail(req);
    this.assertResidentMembership(req, tenantId);

    const member = await this.findTenantMember(tenantId, userId);
    if (!member) {
      throw new NotFoundException('Tenant member not found');
    }

    const normalizedName = dto.name === undefined ? undefined : dto.name.trim();
    const normalizedPhone =
      dto.phone === undefined
        ? undefined
        : typeof dto.phone === 'string'
          ? dto.phone.trim() === ''
            ? null
            : dto.phone.trim()
          : dto.phone;

    const updateData: Prisma.TenantMemberUpdateInput = {};

    if (normalizedName !== undefined && normalizedName !== member.name) {
      updateData.name = normalizedName;
    }

    if (normalizedPhone !== undefined && normalizedPhone !== member.phone) {
      if (normalizedPhone !== null) {
        const duplicatePhone = await this.prisma.tenantMember.findFirst({
          where: {
            tenantId,
            phone: normalizedPhone,
            id: { not: member.id },
          },
          select: { id: true },
        });

        if (duplicatePhone) {
          throw new ConflictException('Phone already in use in this tenant');
        }
      }

      updateData.phone = normalizedPhone;
    }

    if (Object.keys(updateData).length === 0) {
      return this.toProfileResponse(member, email);
    }

    const updatedMember = await this.prisma.tenantMember.update({
      where: { id: member.id },
      data: updateData,
      ...tenantMemberProfileSelect,
    });

    await this.auditService.createLog({
      tenantId,
      actorUserId: userId,
      action: AuditAction.TENANT_MEMBER_UPDATE,
      entityType: 'TenantMember',
      entityId: member.id,
      metadata: {
        changedFields: Object.keys(updateData),
      },
    });

    return this.toProfileResponse(updatedMember, email);
  }

  private async findTenantMember(
    tenantId: string,
    userId: string,
  ): Promise<TenantMemberProfileRecord | null> {
    return this.prisma.tenantMember.findFirst({
      where: {
        tenantId,
        userId,
        disabledAt: null,
      },
      ...tenantMemberProfileSelect,
    });
  }

  private resolveTenantId(req: AuthenticatedRequest): string {
    const tenantId = req.tenantId?.trim() ?? this.getTenantIdFromHeader(req);

    if (!tenantId) {
      throw new BadRequestException('tenantId is required');
    }

    return tenantId;
  }

  private getTenantIdFromHeader(req: AuthenticatedRequest): string | undefined {
    const headerTenantId = req.headers['x-tenant-id'];
    return typeof headerTenantId === 'string' ? headerTenantId.trim() : undefined;
  }

  private resolveUserId(req: AuthenticatedRequest): string {
    const userId = req.user?.id?.trim();

    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    return userId;
  }

  private resolveUserEmail(req: AuthenticatedRequest): string {
    const email = req.user?.email?.trim();

    if (!email) {
      throw new BadRequestException('user email is required');
    }

    return email;
  }

  private assertResidentMembership(
    req: AuthenticatedRequest,
    tenantId: string,
  ): AuthenticatedMembership {
    const membership = (req.user?.memberships ?? []).find((entry) => {
      return entry.tenantId.trim() === tenantId && (entry.roles ?? []).includes(Role.RESIDENT);
    });

    if (!membership) {
      throw new ForbiddenException('Resident membership required');
    }

    return membership;
  }

  private toProfileResponse(member: TenantMemberProfileRecord, email: string): ProfileResponse {
    return {
      id: member.id,
      tenantId: member.tenantId,
      name: member.name,
      email,
      phone: member.phone,
      role: member.role,
      status: member.status,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
    };
  }
}
