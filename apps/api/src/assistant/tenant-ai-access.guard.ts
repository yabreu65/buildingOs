import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Role } from '@buildingos/contracts';
import type { AuthenticatedRequest } from '../common/types/request.types';

const AUTHORIZED_AI_ROLES: readonly Role[] = ['TENANT_OWNER', 'TENANT_ADMIN', 'OPERATOR'];

@Injectable()
export class TenantAiAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & {
      body?: { tenantId?: unknown };
      params?: Record<string, string | undefined>;
      headers?: Record<string, unknown>;
    }>();

    const tenantId = this.resolveTenantId(request);
    const roles = this.resolveRoles(request, tenantId);

    if (!roles.some((role) => AUTHORIZED_AI_ROLES.includes(role))) {
      throw new ForbiddenException(
        'AI settings are available only to tenant owners, admins and operators',
      );
    }

    return true;
  }

  private resolveTenantId(
    request: AuthenticatedRequest & {
      body?: { tenantId?: unknown };
      params?: Record<string, string | undefined>;
      headers?: Record<string, unknown>;
    },
  ): string {
    const memberships = request.user?.memberships ?? [];
    const candidates = [
      this.readString(request.params?.tenantId),
      this.readStringHeader(request.headers?.['x-tenant-id']),
      this.readString(request.body?.tenantId),
    ].filter((candidate): candidate is string => Boolean(candidate));

    if (candidates.length > 0) {
      const uniqueCandidates = new Set(candidates);
      if (uniqueCandidates.size > 1) {
        throw new BadRequestException('Conflicting tenantId sources');
      }

      return candidates[0]!;
    }

    if (memberships.length === 1) {
      return memberships[0]!.tenantId;
    }

    throw new BadRequestException('tenantId is required');
  }

  private resolveRoles(
    request: AuthenticatedRequest,
    tenantId: string,
  ): Role[] {
    if (request.user?.isImpersonating) {
      if (request.user.impersonatedTenantId !== tenantId) {
        throw new ForbiddenException('Impersonation tenant mismatch');
      }

      const effectiveMembership = request.user.effectiveMembership;
      if (effectiveMembership?.tenantId !== tenantId) {
        throw new ForbiddenException('Impersonation membership mismatch');
      }

      return effectiveMembership.roles;
    }

    const effectiveMembership = request.user?.effectiveMembership;
    if (effectiveMembership?.tenantId === tenantId) {
      return effectiveMembership.roles;
    }

    const membership = request.user?.memberships?.find(
      (entry) => entry.tenantId === tenantId,
    );

    if (membership) {
      return membership.roles;
    }

    if (request.user?.tenantId === tenantId && Array.isArray(request.user.roles)) {
      return request.user.roles;
    }

    return [];
  }

  private readStringHeader(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    return this.readString(value);
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }
}
