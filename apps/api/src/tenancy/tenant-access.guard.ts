import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { Request } from 'express';
import type {
  Role,
  ScopeType,
  ScopedRole,
  TenantMembershipRoles,
} from '@buildingos/contracts';
import { PrismaService } from '../prisma/prisma.service';

interface TenantMembershipWithScopedRoles {
  id: string;
  tenantId: string;
  roles: Array<{
    id: string;
    role: Role;
    scopeType: ScopeType;
    scopeBuildingId: string | null;
    scopeUnitId: string | null;
  }>;
}

interface EffectiveTenantMembership extends TenantMembershipRoles {
  id: string;
  scopedRoles: ScopedRole[];
}

export interface RequestWithUser extends Request {
  tenantId?: string;
  user: {
    id: string;
    email: string;
    name: string;
    role?: Role;
    roles?: Role[];
    membershipId?: string;
    tenantId?: string;
    effectiveMembership?: TenantMembershipRoles;
    isImpersonating?: boolean;
    impersonatedTenantId?: string;
    memberships: TenantMembershipRoles[];
  };
}

/**
 * TenantAccessGuard: validates that the authenticated user has membership in
 * the requested tenant and hydrates the effective tenant context for RBAC.
 *
 * Usage:
 * @UseGuards(JwtAuthGuard, TenantAccessGuard)
 * @Get('/tenants/:tenantId/...')
 * async findAll(@TenantParam() tenantId: string) { ... }
 *
 * Behavior:
 * 1. Reads tenantId from route params
 * 2. Reads userId from req.user populated by JwtAuthGuard
 * 3. Loads the requested tenant membership from Prisma
 * 4. Hydrates req.user roles, role, tenantId, membershipId, and
 *    effectiveMembership from the requested tenant
 * 5. Allows the request or throws ForbiddenException (403)
 */
@Injectable()
export class TenantAccessGuard implements CanActivate {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    // JwtAuthGuard must run first and populate the authenticated user.
    const userId = request.user?.id;
    if (!userId) {
      throw new ForbiddenException('Usuario no autenticado');
    }

    // Tenant-scoped routes must carry the tenantId route parameter.
    const tenantId = request.params.tenantId as string | undefined;
    if (!tenantId) {
      throw new BadRequestException(`tenantId es requerido en los parámetros`);
    }

    // Impersonation tokens are tenant-bound and must never fall back to the
    // actor user's database memberships for a different tenant.
    if (request.user.isImpersonating) {
      if (request.user.impersonatedTenantId !== tenantId) {
        throw new ForbiddenException(`No tiene acceso al tenant ${tenantId}`);
      }

      const impersonatedMembership = this.getImpersonatedMembership(
        request,
        tenantId,
      );
      this.assertHasTenantScopedRole(impersonatedMembership, tenantId);
      this.hydrateRequestTenantContext(request, impersonatedMembership);
      return true;
    }

    // Normal flow: check the requested tenant membership in the database.
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_tenantId: {
          userId,
          tenantId,
        },
      },
      include: {
        roles: true,
      },
    });

    if (!membership) {
      throw new ForbiddenException(`No tiene acceso al tenant ${tenantId}`);
    }

    const effectiveMembership = this.toEffectiveTenantMembership(membership);
    this.assertHasTenantScopedRole(effectiveMembership, tenantId);
    this.hydrateRequestTenantContext(request, effectiveMembership);

    return true;
  }

  private toEffectiveTenantMembership(
    membership: TenantMembershipWithScopedRoles,
  ): EffectiveTenantMembership {
    const scopedRoles = membership.roles.map((role) => ({
      id: role.id,
      role: role.role,
      scopeType: role.scopeType,
      scopeBuildingId: role.scopeBuildingId,
      scopeUnitId: role.scopeUnitId,
    }));

    return {
      id: membership.id,
      tenantId: membership.tenantId,
      roles: scopedRoles
        .filter((role) => role.scopeType === 'TENANT')
        .map((role) => role.role),
      scopedRoles,
    };
  }

  private getImpersonatedMembership(
    request: RequestWithUser,
    tenantId: string,
  ): EffectiveTenantMembership {
    const matchingMembership = request.user.memberships.find(
      (membership) => membership.tenantId === tenantId,
    );

    return {
      id: matchingMembership?.id ?? request.user.membershipId ?? '',
      tenantId,
      roles: matchingMembership?.roles ?? request.user.roles ?? [],
      scopedRoles: matchingMembership?.scopedRoles ?? [],
    };
  }

  private assertHasTenantScopedRole(
    membership: EffectiveTenantMembership,
    tenantId: string,
  ): void {
    if (membership.roles.length === 0) {
      throw new ForbiddenException(`No tiene acceso al tenant ${tenantId}`);
    }
  }

  private hydrateRequestTenantContext(
    request: RequestWithUser,
    membership: EffectiveTenantMembership,
  ): void {
    request.tenantId = membership.tenantId;
    request.user.tenantId = membership.tenantId;
    request.user.membershipId = membership.id;
    request.user.roles = membership.roles;
    request.user.role = membership.roles[0];
    request.user.effectiveMembership = membership;
    request.user.memberships = this.replaceMembershipForTenant(
      request.user.memberships,
      membership,
    );
  }

  private replaceMembershipForTenant(
    memberships: TenantMembershipRoles[],
    membership: EffectiveTenantMembership,
  ): TenantMembershipRoles[] {
    let replaced = false;
    const nextMemberships = memberships.map((existingMembership) => {
      if (existingMembership.tenantId !== membership.tenantId) {
        return existingMembership;
      }

      replaced = true;
      return membership;
    });

    if (!replaced) {
      nextMemberships.push(membership);
    }

    return nextMemberships;
  }
}
