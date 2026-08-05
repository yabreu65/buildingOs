import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizeService } from '../rbac/authorize.service';
import {
  ResidentAccessService,
  type ActiveResidentOccupancy,
} from '../resident-access/resident-access.service';
import {
  normalizePortalContextHeader,
  resolveNotificationPortalContext,
} from '../common/portal-context';
import type { PortalContext } from '../common/types/request.types';

interface MembershipRoleShape {
  role: string;
  scopeType: string | null;
  scopeBuildingId: string | null;
  scopeUnitId?: string | null;
}

const membershipRoleSelect = {
  role: true,
  scopeType: true,
  scopeBuildingId: true,
  scopeUnitId: true,
} as const;

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
    private readonly residentAccess: ResidentAccessService,
  ) {}

  private resolvePortalContext(
    userRoles: readonly string[],
    portalContext?: string | null,
  ): PortalContext {
    return resolveNotificationPortalContext(
      userRoles,
      normalizePortalContextHeader(portalContext),
    );
  }

  private async persistContext(
    membershipId: string,
    tenantId: string,
    activeBuildingId: string | null,
    activeUnitId: string | null,
  ): Promise<UserContextData> {
    const userContext = await this.prisma.userContext.upsert({
      where: { membershipId },
      update: {
        tenantId,
        activeBuildingId,
        activeUnitId,
      },
      create: {
        tenantId,
        membershipId,
        activeBuildingId,
        activeUnitId,
      },
    });

    return {
      tenantId,
      activeBuildingId: userContext.activeBuildingId,
      activeUnitId: userContext.activeUnitId,
    };
  }

  private async resolveResidentContextState(
    tenantId: string,
    userId: string,
    currentContext?: { activeBuildingId?: string | null; activeUnitId?: string | null } | null,
  ): Promise<ActiveResidentOccupancy | null> {
    const activeBuildingId = currentContext?.activeBuildingId ?? null;
    const activeUnitId = currentContext?.activeUnitId ?? null;

    if (activeUnitId) {
      const selectedOccupancy = await this.residentAccess.resolveActiveResidentOccupancy({
        tenantId,
        userId,
        unitId: activeUnitId,
      });

      if (selectedOccupancy) {
        return selectedOccupancy;
      }
    }

    if (activeBuildingId) {
      const selectedOccupancy = await this.residentAccess.resolveActiveResidentOccupancy({
        tenantId,
        userId,
        buildingId: activeBuildingId,
      });

      if (selectedOccupancy) {
        return selectedOccupancy;
      }
    }

    return this.residentAccess.resolveActiveResidentOccupancy({
      tenantId,
      userId,
    });
  }

  /**
   * Get current context for user/tenant
   */
  async getContext(
    userId: string,
    tenantId: string,
    portalContext?: string | null,
  ): Promise<UserContextData> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: {
        userContext: true,
        roles: { where: { tenantId }, select: membershipRoleSelect },
      },
    });

    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    const roles = membership.roles || [];
    const isResidentPortal = this.resolvePortalContext(
      roles.map((role) => role.role),
      portalContext,
    ) === 'resident';

    if (isResidentPortal) {
      const resolvedOccupancy = await this.resolveResidentContextState(
        tenantId,
        userId,
        membership.userContext,
      );

      const nextBuildingId = resolvedOccupancy?.buildingId ?? null;
      const nextUnitId = resolvedOccupancy?.unitId ?? null;
      const currentBuildingId = membership.userContext?.activeBuildingId ?? null;
      const currentUnitId = membership.userContext?.activeUnitId ?? null;

      if (
        !membership.userContext ||
        currentBuildingId !== nextBuildingId ||
        currentUnitId !== nextUnitId
      ) {
        return this.persistContext(
          membership.id,
          tenantId,
          nextBuildingId,
          nextUnitId,
        );
      }

      return {
        tenantId,
        activeBuildingId: currentBuildingId,
        activeUnitId: currentUnitId,
      };
    }

    // Auto-initialize if no context exists OR if context is empty (both null — never properly initialized)
    const ctx = membership.userContext;
    if (!ctx || (!ctx.activeBuildingId && !ctx.activeUnitId)) {
      return this.initializeContext(userId, tenantId, portalContext);
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
    portalContext?: string | null,
  ): Promise<UserContextData> {
    // Get membership
    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { userContext: true, roles: { where: { tenantId }, select: membershipRoleSelect } },
    });

    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    // Determine effective building and unit IDs
    let effectiveBuildingId: string | null = activeBuildingId ?? null;
    let effectiveUnitId: string | null = activeUnitId ?? null;

    // If unit is specified, derive/validate building
    if (effectiveUnitId) {
      const unit = await this.prisma.unit.findFirst({
        where: { id: effectiveUnitId, tenantId, building: { deletedAt: null } },
        include: { building: true },
      });

      if (!unit) {
        throw new NotFoundException('Unit not found or does not belong to this tenant');
      }

      // Auto-set building to unit's building
      effectiveBuildingId = unit.buildingId;
    }

    // Determine if user is RESIDENT (skip buildings.read check — they validate via UnitOccupant)
    const rolesForCheck = membership.roles || [];
    const isResidentPortal =
      this.resolvePortalContext(rolesForCheck.map((role) => role.role), portalContext) === 'resident';

    if (isResidentPortal) {
      if (effectiveUnitId) {
        const occupancy = await this.residentAccess.resolveActiveResidentOccupancy({
          tenantId,
          userId,
          unitId: effectiveUnitId,
          buildingId: effectiveBuildingId ?? undefined,
        });

        if (!occupancy) {
          throw new NotFoundException('Unit not found or does not belong to you');
        }

        effectiveBuildingId = occupancy.buildingId;
        effectiveUnitId = occupancy.unitId;
      } else if (effectiveBuildingId) {
        const occupancy = await this.residentAccess.resolveActiveResidentOccupancy({
          tenantId,
          userId,
          buildingId: effectiveBuildingId,
        });

        if (!occupancy) {
          throw new NotFoundException('Building not found or does not belong to this tenant');
        }

        effectiveBuildingId = occupancy.buildingId;
        effectiveUnitId = occupancy.unitId;
      }
    }

    // Validate building if specified
    if (effectiveBuildingId) {
      const building = await this.prisma.building.findFirst({
        where: { id: effectiveBuildingId, tenantId, deletedAt: null },
      });

      if (!building) {
        throw new NotFoundException('Building not found or does not belong to this tenant');
      }

      if (isResidentPortal && !effectiveUnitId) {
        await this.residentAccess.assertBuildingAccess(tenantId, userId, effectiveBuildingId);
      }

      if (!isResidentPortal) {
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
      const isResident = this.resolvePortalContext(
        roles.map((role) => role.role),
        portalContext,
      ) === 'resident';

      if (isResident) {
        await this.residentAccess.assertUnitAccess(
          tenantId,
          userId,
          effectiveUnitId,
          effectiveBuildingId ?? undefined,
        );
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

    return this.persistContext(
      membership.id,
      tenantId,
      effectiveBuildingId,
      effectiveUnitId,
    );
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
    portalContext?: string | null,
  ): Promise<ContextOptions> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: {
        roles: { where: { tenantId }, select: membershipRoleSelect },
      },
    });

    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    const isResidentPortal =
      this.resolvePortalContext(
        (membership.roles || []).map((role) => role.role),
        portalContext,
      ) === 'resident';

    // Get buildings user can access
    const buildings = await this.getAccessibleBuildings(
      membership.roles || [],
      userId,
      tenantId,
      isResidentPortal,
    );

    // Get units per building
    const unitsByBuilding: Record<string, ContextOption[]> = {};
    for (const building of buildings) {
      unitsByBuilding[building.id] = await this.getAccessibleUnits(
        membership.roles || [],
        userId,
        tenantId,
        building.id,
        isResidentPortal,
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
    isResidentPortal: boolean,
  ): Promise<ContextOption[]> {
    // RESIDENT always derives buildings from their UnitOccupant records (regardless of scopeType)
    if (isResidentPortal) {
      const buildingIds = await this.residentAccess.getActiveBuildingIds(tenantId, userId);
      if (buildingIds.length === 0) return [];
      const buildings = await this.prisma.building.findMany({
        where: { tenantId, id: { in: buildingIds }, deletedAt: null },
        select: { id: true, name: true },
      });
      return buildings.sort((a, b) =>
        a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' }) ||
        a.id.localeCompare(b.id, 'es', { numeric: true, sensitivity: 'base' }),
      );
    }

    // Non-RESIDENT: check scope
    const hasTenantScope = roles.some((r: MembershipRoleShape) => r.scopeType === 'TENANT');
    if (hasTenantScope) {
      const buildings = await this.prisma.building.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, name: true },
      });
      return buildings.sort((a, b) =>
        a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' }) ||
        a.id.localeCompare(b.id, 'es', { numeric: true, sensitivity: 'base' }),
      );
    }

    const buildingScopedRoles = roles.filter((r: MembershipRoleShape) => r.scopeType === 'BUILDING');
    const buildingIds = buildingScopedRoles
      .map((r: MembershipRoleShape) => r.scopeBuildingId)
      .filter((id: string | null) => id !== null);

    if (buildingIds.length > 0) {
      const buildings = await this.prisma.building.findMany({
        where: { tenantId, id: { in: buildingIds }, deletedAt: null },
        select: { id: true, name: true },
      });
      return buildings.sort((a, b) =>
        a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' }) ||
        a.id.localeCompare(b.id, 'es', { numeric: true, sensitivity: 'base' }),
      );
    }

    const unitScopedRoles = roles.filter((r: MembershipRoleShape) => r.scopeType === 'UNIT');
    const unitIds = unitScopedRoles
      .map((r: MembershipRoleShape) => r.scopeUnitId)
      .filter((id: string | null | undefined): id is string => typeof id === 'string' && id.length > 0);

    if (unitIds.length > 0) {
      const units = await this.prisma.unit.findMany({
        where: {
          tenantId,
          id: { in: unitIds },
          building: { deletedAt: null },
        },
        select: { buildingId: true },
      });
      const derivedBuildingIds = [...new Set(units.map((unit) => unit.buildingId))];

      if (derivedBuildingIds.length > 0) {
        const buildings = await this.prisma.building.findMany({
          where: { tenantId, id: { in: derivedBuildingIds }, deletedAt: null },
          select: { id: true, name: true },
        });
        return buildings.sort((a, b) =>
          a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' }) ||
          a.id.localeCompare(b.id, 'es', { numeric: true, sensitivity: 'base' }),
        );
      }
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
    isResidentPortal: boolean,
  ): Promise<ContextOption[]> {

    // Check role scopes
    const hasTenantScope = roles.some((r: MembershipRoleShape) => r.scopeType === 'TENANT');
    const hasBuildingScope = roles.some(
      (r: MembershipRoleShape) => r.scopeType === 'BUILDING' && r.scopeBuildingId === buildingId,
    );
    const hasUnitScope = roles.some((r: MembershipRoleShape) => r.scopeType === 'UNIT');

    // RESIDENT always sees only units where they are an occupant — regardless of scope
    if (isResidentPortal) {
      const unitIds = await this.residentAccess.getActiveUnitIds(_tenantId, userId, buildingId);
      if (unitIds.length === 0) return [];
      const units = await this.prisma.unit.findMany({
        where: {
          tenantId: _tenantId,
          buildingId,
          building: { deletedAt: null },
          id: { in: unitIds },
        },
        select: { id: true, code: true, label: true },
      });
      return units.sort((a, b) =>
        (a.code ?? '').localeCompare(b.code ?? '', 'es', { numeric: true, sensitivity: 'base' }) ||
        (a.label ?? '').localeCompare(b.label ?? '', 'es', { numeric: true, sensitivity: 'base' }) ||
        a.id.localeCompare(b.id, 'es', { numeric: true, sensitivity: 'base' }),
      );
    }

    // If TENANT or BUILDING scoped: return all units in building
    if (hasTenantScope || hasBuildingScope) {
      const units = await this.prisma.unit.findMany({
        where: {
          tenantId: _tenantId,
          buildingId,
          building: { deletedAt: null },
        },
        select: { id: true, code: true, label: true },
      });
      return units.sort((a, b) =>
        (a.code ?? '').localeCompare(b.code ?? '', 'es', { numeric: true, sensitivity: 'base' }) ||
        (a.label ?? '').localeCompare(b.label ?? '', 'es', { numeric: true, sensitivity: 'base' }) ||
        a.id.localeCompare(b.id, 'es', { numeric: true, sensitivity: 'base' }),
      );
    }

    // If only UNIT-scoped: return units in this building that user has scope for
    if (hasUnitScope) {
      const unitScopedRoles = roles.filter((r: MembershipRoleShape) => r.scopeType === 'UNIT');
      const unitIds = unitScopedRoles
        .map((r: MembershipRoleShape) => r.scopeUnitId)
        .filter((id): id is string => id !== null && id !== undefined);

      const units = await this.prisma.unit.findMany({
        where: {
          tenantId: _tenantId,
          buildingId,
          building: { deletedAt: null },
          id: { in: unitIds },
        },
        select: { id: true, code: true, label: true },
      });
      return units.sort((a, b) =>
        (a.code ?? '').localeCompare(b.code ?? '', 'es', { numeric: true, sensitivity: 'base' }) ||
        (a.label ?? '').localeCompare(b.label ?? '', 'es', { numeric: true, sensitivity: 'base' }) ||
        a.id.localeCompare(b.id, 'es', { numeric: true, sensitivity: 'base' }),
      );
    }

    return [];
  }

  /**
   * Auto-initialize context for new user
   * Called after first login to set default active building/unit
   */
  async initializeContext(
    userId: string,
    tenantId: string,
    portalContext?: string | null,
  ): Promise<UserContextData> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { userContext: true, roles: { where: { tenantId }, select: membershipRoleSelect } },
    });

    if (!membership || membership.userContext) {
      // Already has context or no membership
      return {
        tenantId,
        activeBuildingId: membership?.userContext?.activeBuildingId ?? null,
        activeUnitId: membership?.userContext?.activeUnitId ?? null,
      };
    }

    const roles = membership.roles || [];
    const isResidentPortal = this.resolvePortalContext(
      roles.map((role) => role.role),
      portalContext,
    ) === 'resident';

    if (isResidentPortal) {
      const resolvedOccupancy = await this.resolveResidentContextState(tenantId, userId, null);

      return this.persistContext(
        membership.id,
        tenantId,
        resolvedOccupancy?.buildingId ?? null,
        resolvedOccupancy?.unitId ?? null,
      );
    }

    // Auto-select building if only one is accessible
    const buildings = await this.getAccessibleBuildings(
      membership.roles || [],
      userId,
      tenantId,
      false,
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
        false,
      );
      if (units.length === 1) {
        return this.setContext(userId, tenantId, building.id, units[0]!.id);
      }

      return this.setContext(userId, tenantId, building.id);
    }

    // No auto-selection possible, just create empty context
    await this.prisma.userContext.create({
      data: {
        tenantId,
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
