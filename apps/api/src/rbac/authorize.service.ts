import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Permission, PERMISSIONS } from './permissions';

export interface AuthorizeParams {
  userId: string;
  tenantId: string;
  permission: Permission;
  buildingId?: string;
  unitId?: string;
}

/**
 * AuthorizeService: Cascading RBAC with scoped roles
 *
 * Decision logic (A→B→C→D):
 * A) ¿Tiene role TENANT-scoped con permiso? → permitido
 * B) ¿Tiene role BUILDING-scoped para context.buildingId con permiso? → permitido
 * C) ¿Tiene role UNIT-scoped para context.unitId con permiso? → permitido
 * D) ¿Tiene role BUILDING-scoped para el building padre del context.unitId? → permitido
 *    (OPERATOR de building puede operar sus units)
 */
@Injectable()
export class AuthorizeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check if user has permission in the given context
   * Returns boolean instead of throwing
   */
  async authorize(params: AuthorizeParams): Promise<boolean> {
    const { userId, tenantId, permission, buildingId, unitId } = params;

    // 1. Get user's membership and all roles
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_tenantId: { userId, tenantId },
      },
      include: {
        roles: true,
      },
    });

    if (!membership) {
      return false; // User not member of this tenant
    }

    // 2. Check TENANT-scoped roles (A)
    const tenantScopedRoles = membership.roles
      .filter((r) => r.scopeType === 'TENANT')
      .map((r) => r.role);

    if (this.hasPermission(tenantScopedRoles, permission)) {
      return true;
    }

    // 3. Check BUILDING-scoped roles (B)
    if (buildingId) {
      const buildingScopedRoles = membership.roles
        .filter((r) => r.scopeType === 'BUILDING' && r.scopeBuildingId === buildingId)
        .map((r) => r.role);

      if (this.hasPermission(buildingScopedRoles, permission)) {
        return true;
      }
    }

    // 4. Check UNIT-scoped roles (C)
    if (unitId) {
      const unitScopedRoles = membership.roles
        .filter((r) => r.scopeType === 'UNIT' && r.scopeUnitId === unitId)
        .map((r) => r.role);

      if (this.hasPermission(unitScopedRoles, permission)) {
        return true;
      }

      // 5. Check BUILDING-scoped roles for the unit's building parent (D)
      const unit = await this.prisma.unit.findUnique({
        where: { id: unitId },
        select: { buildingId: true },
      });

      if (unit) {
        const buildingScopedRolesForUnit = membership.roles
          .filter((r) => r.scopeType === 'BUILDING' && r.scopeBuildingId === unit.buildingId)
          .map((r) => r.role);

        if (this.hasPermission(buildingScopedRolesForUnit, permission)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Throws ForbiddenException if not authorized
   */
  async authorizeOrThrow(params: AuthorizeParams): Promise<void> {
    const isAuthorized = await this.authorize(params);
    if (!isAuthorized) {
      // ForbiddenException is lazy-imported to avoid circular deps
      const { ForbiddenException } = await import('@nestjs/common');
      throw new ForbiddenException('Unauthorized access to this resource');
    }
  }

  /**
   * Helper: check if roles array contains any role with given permission
   */
  private hasPermission(roles: string[], permission: Permission): boolean {
    return roles.some((role) => {
      const rolePermissions = PERMISSIONS[role] || [];
      return rolePermissions.includes(permission);
    });
  }
}
