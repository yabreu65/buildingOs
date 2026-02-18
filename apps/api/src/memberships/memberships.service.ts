import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AddRoleDto, ScopeTypeDto } from './dto/add-role.dto';
import { MembershipRole, Role } from '@prisma/client';

export interface ScopedRoleResponse {
  id: string;
  role: Role;
  scopeType: string;
  scopeBuildingId: string | null;
  scopeUnitId: string | null;
}

@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Get all roles for a membership with scope information
   */
  async getRoles(membershipId: string): Promise<ScopedRoleResponse[]> {
    const roles = await this.prisma.membershipRole.findMany({
      where: { membershipId },
      select: {
        id: true,
        role: true,
        scopeType: true,
        scopeBuildingId: true,
        scopeUnitId: true,
      },
    });

    return roles.map((r) => ({
      id: r.id,
      role: r.role,
      scopeType: r.scopeType,
      scopeBuildingId: r.scopeBuildingId,
      scopeUnitId: r.scopeUnitId,
    }));
  }

  /**
   * Add a scoped role to a membership
   *
   * Validations:
   * 1. Membership must exist and belong to tenant
   * 2. SUPER_ADMIN cannot be assigned via this endpoint
   * 3. Scope integrity: TENANT scope must have no building/unit IDs
   * 4. Scope integrity: BUILDING scope must have valid building in tenant
   * 5. Scope integrity: UNIT scope must have valid unit in tenant's building
   * 6. Prevent duplicates: check for existing role+scope combination
   */
  async addRole(
    tenantId: string,
    membershipId: string,
    actorMembershipId: string,
    dto: AddRoleDto,
  ): Promise<ScopedRoleResponse> {
    // 1. Verify membership exists and belongs to tenant
    const membership = await this.prisma.membership.findUnique({
      where: { id: membershipId },
      include: { user: true },
    });

    if (!membership || membership.tenantId !== tenantId) {
      throw new NotFoundException('Membership not found');
    }

    // 2. Prevent assigning SUPER_ADMIN via this endpoint (only SUPER_ADMIN system admin can do this)
    if (dto.role === 'SUPER_ADMIN') {
      throw new BadRequestException('Cannot assign SUPER_ADMIN role via this endpoint');
    }

    // 3. Validate scope consistency
    if (dto.scopeType === 'TENANT') {
      if (dto.scopeBuildingId || dto.scopeUnitId) {
        throw new BadRequestException(
          'TENANT scope must not have building or unit IDs',
        );
      }
    }

    // 4. Validate BUILDING scope
    if (dto.scopeType === 'BUILDING') {
      if (!dto.scopeBuildingId) {
        throw new BadRequestException('BUILDING scope requires scopeBuildingId');
      }

      const building = await this.prisma.building.findUnique({
        where: { id: dto.scopeBuildingId },
        select: { tenantId: true },
      });

      if (!building || building.tenantId !== tenantId) {
        throw new BadRequestException('Building not found in this tenant');
      }

      if (dto.scopeUnitId) {
        throw new BadRequestException(
          'BUILDING scope must not have unitId',
        );
      }
    }

    // 5. Validate UNIT scope
    if (dto.scopeType === 'UNIT') {
      if (!dto.scopeUnitId) {
        throw new BadRequestException('UNIT scope requires scopeUnitId');
      }

      const unit = await this.prisma.unit.findUnique({
        where: { id: dto.scopeUnitId },
        include: { building: { select: { tenantId: true } } },
      });

      if (!unit || unit.building.tenantId !== tenantId) {
        throw new BadRequestException('Unit not found in this tenant');
      }

      // UNIT scope also requires building context (implicit from unit.buildingId)
      // So scopeBuildingId should be null (we'll derive it from the unit)
    }

    // 6. Check for duplicates
    const existingRole = await this.prisma.membershipRole.findFirst({
      where: {
        membershipId,
        role: dto.role,
        scopeType: dto.scopeType,
        scopeBuildingId: dto.scopeBuildingId || null,
        scopeUnitId: dto.scopeUnitId || null,
      },
    });

    if (existingRole) {
      throw new ConflictException(
        `Role ${dto.role} already assigned with this scope`,
      );
    }

    // 7. Create the role
    const role = await this.prisma.membershipRole.create({
      data: {
        membershipId,
        role: dto.role,
        scopeType: dto.scopeType,
        scopeBuildingId: dto.scopeBuildingId || null,
        scopeUnitId: dto.scopeUnitId || null,
      },
      select: {
        id: true,
        role: true,
        scopeType: true,
        scopeBuildingId: true,
        scopeUnitId: true,
      },
    });

    // 8. Audit log
    await this.audit.createLog({
      tenantId,
      actorMembershipId,
      action: 'ROLE_ASSIGNED',
      entityType: 'Membership',
      entityId: membershipId,
      metadata: {
        role: role.role,
        scopeType: role.scopeType,
        scopeBuildingId: role.scopeBuildingId,
        scopeUnitId: role.scopeUnitId,
        targetUserId: membership.userId,
        targetUserName: membership.user.name,
      },
    });

    return {
      id: role.id,
      role: role.role,
      scopeType: role.scopeType,
      scopeBuildingId: role.scopeBuildingId,
      scopeUnitId: role.scopeUnitId,
    };
  }

  /**
   * Remove a role from a membership
   */
  async removeRole(
    tenantId: string,
    membershipId: string,
    roleId: string,
    actorMembershipId: string,
  ): Promise<void> {
    // Verify membership belongs to tenant
    const membership = await this.prisma.membership.findUnique({
      where: { id: membershipId },
      include: { user: true, roles: { where: { id: roleId } } },
    });

    if (!membership || membership.tenantId !== tenantId) {
      throw new NotFoundException('Membership not found');
    }

    if (membership.roles.length === 0) {
      throw new NotFoundException('Role not found');
    }

    const role = membership.roles[0];

    // Delete the role
    await this.prisma.membershipRole.delete({
      where: { id: roleId },
    });

    // Audit log
    await this.audit.createLog({
      tenantId,
      actorMembershipId,
      action: 'ROLE_REMOVED',
      entityType: 'Membership',
      entityId: membershipId,
      metadata: {
        role: role.role,
        scopeType: role.scopeType,
        scopeBuildingId: role.scopeBuildingId,
        scopeUnitId: role.scopeUnitId,
        targetUserId: membership.userId,
        targetUserName: membership.user.name,
      },
    });
  }
}
