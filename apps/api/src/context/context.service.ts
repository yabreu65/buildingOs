import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizeService } from '../rbac/authorize.service';

interface MembershipRoleShape {
  role: string;
  scopeType: string | null;
  scopeBuildingId: string | null;
  scopeUnitId?: string | null;
}

export interface UserContextData {
  tenantId: string;
  activeBuildingId?: string | null;
  activeUnitId?: string | null;
}

export interface ContextOption {
  id: string;
  name?: string;
  code?: string;
  label?: string | null;
}

export interface ContextOptions {
  buildings: ContextOption[];
  unitsByBuilding: Record<string, ContextOption[]>;
}

@Injectable()
export class ContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorize: AuthorizeService,
  ) {}

  /**
   * Get current context for user/tenant
   */
  async getContext(userId: string, tenantId: string): Promise<UserContextData> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { userContext: true },
    });

    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    // Auto-initialize if no context exists OR if context is empty (both null — never properly initialized)
    const ctx = membership.userContext;
    if (!ctx || (!ctx.activeBuildingId && !ctx.activeUnitId)) {
      return this.initializeContext(userId, tenantId);
    }

    return {
      tenantId,
      activeBuildingId: ctx.activeBuildingId ?? null,
      activeUnitId: ctx.activeUnitId ?? null,
    };
  }

  /**
   * Set context: active building and/or unit
   *
   * Validations:
   * 1. Building must belong to tenant
   * 2. Unit must belong to building (if set)
   * 3. User must have access to building/unit per their roles and occupant status
   * 4. If unit is set, building is auto-set (or validated)
   */
  async setContext(
    userId: string,
    tenantId: string,
    activeBuildingId?: string | null,
    activeUnitId?: string | null,
  ): Promise<UserContextData> {
    // Get membership
    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { userContext: true, user: true, roles: true },
    });

    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    // Determine effective building and unit IDs
    let effectiveBuildingId: string | null = activeBuildingId ?? null;
    let effectiveUnitId: string | null = activeUnitId ?? null;

    // If unit is specified, derive/validate building
    if (effectiveUnitId) {
      const unit = await this.prisma.unit.findUnique({
        where: { id: effectiveUnitId },
        include: { building: true },
      });

      if (!unit || unit.building.tenantId !== tenantId) {
        throw new NotFoundException('Unit not found or does not belong to this tenant');
      }

      // Auto-set building to unit's building
      effectiveBuildingId = unit.buildingId;
    }

    // Determine if user is RESIDENT (skip buildings.read check — they validate via UnitOccupant)
    const rolesForCheck = membership.roles || [];
    const isResidentForBuildingCheck = rolesForCheck.some((r: MembershipRoleShape) => r.role === 'RESIDENT');

    // Validate building if specified
    if (effectiveBuildingId) {
      const building = await this.prisma.building.findUnique({
        where: { id: effectiveBuildingId },
      });

      if (!building || building.tenantId !== tenantId) {
        throw new NotFoundException('Building not found or does not belong to this tenant');
      }

      // RESIDENT access is validated at unit level via UnitOccupant — skip buildings.read check
      if (!isResidentForBuildingCheck) {
        const hasAccess = await this.authorize.authorize({
          userId,
          tenantId,
          permission: 'buildings.read',
          buildingId: effectiveBuildingId,
        });

        if (!hasAccess) {
          throw new ForbiddenException('No access to this building');
        }
      }
    }

    // If unit is specified, validate access
    if (effectiveUnitId) {
      // Get user's roles to check if RESIDENT
      const roles = membership.roles || [];
      const isResident = roles.some((r: MembershipRoleShape) => r.role === 'RESIDENT');

      if (isResident) {
        // RESIDENT: can only access units where they are an occupant
        // First find the TenantMember for this user
        const member = await this.prisma.tenantMember.findFirst({
          where: {
            tenantId,
            userId,
          },
          select: { id: true },
        });

        if (!member) {
          throw new ForbiddenException('No access to this unit');
        }

        const isOccupant = await this.prisma.unitOccupant.findFirst({
          where: {
            unitId: effectiveUnitId,
            memberId: member.id,
          },
        });

        if (!isOccupant) {
          throw new ForbiddenException('No access to this unit');
        }
      } else {
        // Non-RESIDENT: validate via AuthorizeService
        const hasAccess = await this.authorize.authorize({
          userId,
          tenantId,
          permission: 'units.read',
          buildingId: effectiveBuildingId || undefined,
          unitId: effectiveUnitId,
        });

        if (!hasAccess) {
          throw new ForbiddenException('No access to this unit');
        }
      }
    }

    // Upsert or update UserContext
    const userContext = await this.prisma.userContext.upsert({
      where: { membershipId: membership.id },
      update: {
        activeBuildingId: effectiveBuildingId,
        activeUnitId: effectiveUnitId,
      },
      create: {
        membershipId: membership.id,
        activeBuildingId: effectiveBuildingId,
        activeUnitId: effectiveUnitId,
      },
    });

    return {
      tenantId,
      activeBuildingId: userContext.activeBuildingId,
      activeUnitId: userContext.activeUnitId,
    };
  }

  /**
   * Get available context options for user
   *
   * Returns buildings and units that user can access based on:
   * - Role scopes (tenant-wide, building-scoped, unit-scoped)
   * - Occupant status (for RESIDENT)
   */
  async getContextOptions(
    userId: string,
    tenantId: string,
  ): Promise<ContextOptions> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: {
        roles: true,
        user: true,
      },
    });

    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    // Get buildings user can access
    const buildings = await this.getAccessibleBuildings(
      membership.roles || [],
      userId,
      tenantId,
    );

    // Get units per building
    const unitsByBuilding: Record<string, ContextOption[]> = {};
    for (const building of buildings) {
      unitsByBuilding[building.id] = await this.getAccessibleUnits(
        membership.roles || [],
        userId,
        tenantId,
        building.id,
      );
    }

    return {
      buildings,
      unitsByBuilding,
    };
  }

  /**
   * Get buildings accessible to user based on roles and scope
   */
  private async getAccessibleBuildings(
    roles: MembershipRoleShape[],
    userId: string,
    tenantId: string,
  ): Promise<ContextOption[]> {
    // RESIDENT always derives buildings from their UnitOccupant records (regardless of scopeType)
    const isResident = roles.some((r: MembershipRoleShape) => r.role === 'RESIDENT');
    if (isResident) {
      const member = await this.prisma.tenantMember.findFirst({
        where: { tenantId, userId },
        select: { id: true },
      });

      if (!member) return [];

      const occupancies = await this.prisma.unitOccupant.findMany({
        where: { memberId: member.id },
        include: { unit: { include: { building: true } } },
      });

      const seen = new Set<string>();
      const buildings: ContextOption[] = [];
      for (const occ of occupancies) {
        if (!seen.has(occ.unit.buildingId)) {
          seen.add(occ.unit.buildingId);
          buildings.push({ id: occ.unit.buildingId, name: occ.unit.building.name });
        }
      }
      return buildings;
    }

    // Non-RESIDENT: check scope
    const hasTenantScope = roles.some((r: MembershipRoleShape) => r.scopeType === 'TENANT');
    if (hasTenantScope) {
      return this.prisma.building.findMany({
        where: { tenantId },
        select: { id: true, name: true },
      });
    }

    const buildingScopedRoles = roles.filter((r: MembershipRoleShape) => r.scopeType === 'BUILDING');
    const buildingIds = buildingScopedRoles
      .map((r: MembershipRoleShape) => r.scopeBuildingId)
      .filter((id: string | null) => id !== null);

    if (buildingIds.length > 0) {
      return this.prisma.building.findMany({
        where: { id: { in: buildingIds } },
        select: { id: true, name: true },
      });
    }

    return [];
  }

  /**
   * Get units accessible to user in a specific building
   */
  private async getAccessibleUnits(
    roles: MembershipRoleShape[],
    userId: string,
    _tenantId: string,
    buildingId: string,
  ): Promise<ContextOption[]> {

    // Check role scopes
    const hasTenantScope = roles.some((r: MembershipRoleShape) => r.scopeType === 'TENANT');
    const hasBuildingScope = roles.some(
      (r: MembershipRoleShape) => r.scopeType === 'BUILDING' && r.scopeBuildingId === buildingId,
    );
    const hasUnitScope = roles.some((r: MembershipRoleShape) => r.scopeType === 'UNIT');

    // RESIDENT always sees only units where they are an occupant — regardless of scope
    const isResident = roles.some((r: MembershipRoleShape) => r.role === 'RESIDENT');
    if (isResident) {
      // Find the TenantMember for this user
      const member = await this.prisma.tenantMember.findFirst({
        where: {
          tenantId: _tenantId,
          userId,
        },
        select: { id: true },
      });

      if (!member) {
        return [];
      }

      return this.prisma.unit.findMany({
        where: {
          buildingId,
          unitOccupants: {
            some: { memberId: member.id },
          },
        },
        select: { id: true, code: true, label: true },
      });
    }

    // If TENANT or BUILDING scoped: return all units in building
    if (hasTenantScope || hasBuildingScope) {
      return this.prisma.unit.findMany({
        where: { buildingId },
        select: { id: true, code: true, label: true },
      });
    }

    // If only UNIT-scoped: return units in this building that user has scope for
    if (hasUnitScope) {
      const unitScopedRoles = roles.filter((r: MembershipRoleShape) => r.scopeType === 'UNIT');
      const unitIds = unitScopedRoles
        .map((r: MembershipRoleShape) => r.scopeUnitId)
        .filter((id): id is string => id !== null && id !== undefined);

      return this.prisma.unit.findMany({
        where: {
          buildingId,
          id: { in: unitIds },
        },
        select: { id: true, code: true, label: true },
      });
    }

    return [];
  }

  /**
   * Auto-initialize context for new user
   * Called after first login to set default active building/unit
   */
  async initializeContext(userId: string, tenantId: string): Promise<UserContextData> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { userContext: true, roles: true, user: true },
    });

    if (!membership || membership.userContext) {
      // Already has context or no membership
      return {
        tenantId,
        activeBuildingId: membership?.userContext?.activeBuildingId ?? null,
        activeUnitId: membership?.userContext?.activeUnitId ?? null,
      };
    }

    // Auto-select building if only one is accessible
    const buildings = await this.getAccessibleBuildings(
      membership.roles || [],
      userId,
      tenantId,
    );
    if (buildings.length === 1) {
      // Auto-select this building
      const building = buildings[0]!;

      // For RESIDENT: auto-select unit if only one
      const units = await this.getAccessibleUnits(
        membership.roles || [],
        userId,
        tenantId,
        building.id,
      );
      if (units.length === 1) {
        return this.setContext(userId, tenantId, building.id, units[0]!.id);
      }

      return this.setContext(userId, tenantId, building.id);
    }

    // No auto-selection possible, just create empty context
    await this.prisma.userContext.create({
      data: {
        membershipId: membership.id,
      },
    });

    return {
      tenantId,
      activeBuildingId: null,
      activeUnitId: null,
    };
  }
}
