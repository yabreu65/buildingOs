import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Role } from '@buildingos/contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedRequest } from '../common/types/request.types';

interface TenantMembershipWithRoles {
  readonly id: string;
  readonly tenantId: string;
  readonly roles: Role[];
}

@Injectable()
export class NotificationFeedAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.id;
    if (!userId) {
      throw new ForbiddenException('Usuario no autenticado');
    }

    const tenantId = request.params.tenantId?.trim();
    if (!tenantId) {
      throw new BadRequestException('tenantId es requerido en los parámetros');
    }

    if (request.user.isImpersonating) {
      if (request.user.impersonatedTenantId !== tenantId) {
        throw new ForbiddenException(`No tiene acceso al tenant ${tenantId}`);
      }

      const impersonatedMembership = this.getImpersonatedMembership(request, tenantId);
      this.assertHasTenantScopedRole(impersonatedMembership, tenantId);
      this.hydrateRequestTenantContext(request, impersonatedMembership);
      return true;
    }

    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_tenantId: {
          userId,
          tenantId,
        },
      },
      select: {
        id: true,
        tenantId: true,
        roles: {
          select: {
            id: true,
            role: true,
            scopeType: true,
            scopeBuildingId: true,
            scopeUnitId: true,
          },
        },
      },
    });

    if (!membership || membership.roles.length === 0) {
      throw new ForbiddenException(`No tiene acceso al tenant ${tenantId}`);
    }

    this.hydrateRequestTenantContext(request, {
      id: membership.id,
      tenantId: membership.tenantId,
      roles: membership.roles.map((membershipRole) => membershipRole.role),
    });

    return true;
  }

  private getImpersonatedMembership(
    request: AuthenticatedRequest,
    tenantId: string,
  ): TenantMembershipWithRoles {
    const matchingMembership = request.user.memberships?.find((membership) => membership.tenantId === tenantId);

    return {
      id: matchingMembership?.id ?? request.user.membershipId ?? '',
      tenantId,
      roles: matchingMembership?.roles ?? request.user.roles ?? [],
    };
  }

  private assertHasTenantScopedRole(
    membership: TenantMembershipWithRoles,
    tenantId: string,
  ): void {
    if (membership.roles.length === 0) {
      throw new ForbiddenException(`No tiene acceso al tenant ${tenantId}`);
    }
  }

  private hydrateRequestTenantContext(
    request: AuthenticatedRequest,
    membership: TenantMembershipWithRoles,
  ): void {
    request.tenantId = membership.tenantId;
    request.user.tenantId = membership.tenantId;
    request.user.membershipId = membership.id;
    request.user.roles = membership.roles;
    request.user.role = membership.roles[0];
    request.user.effectiveMembership = membership;
    request.user.memberships = this.replaceMembershipForTenant(request.user.memberships ?? [], membership);
  }

  private replaceMembershipForTenant(
    memberships: NonNullable<AuthenticatedRequest['user']['memberships']>,
    membership: TenantMembershipWithRoles,
  ): NonNullable<AuthenticatedRequest['user']['memberships']> {
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
