import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { AuthenticatedRequest } from './types/request.types';

export interface TenantMembershipContext {
  tenantId: string;
  membershipId: string;
  roles: string[];
}

export function resolveTenantMembershipContext(
  req: AuthenticatedRequest,
): TenantMembershipContext {
  const tenantId = req.tenantId?.trim() ?? req.user?.tenantId?.trim();
  if (!tenantId) {
    throw new BadRequestException('tenantId is required');
  }

  const effectiveMembership = req.user?.effectiveMembership;
  if (effectiveMembership) {
    if (effectiveMembership.tenantId.trim() !== tenantId) {
      throw new ForbiddenException('effectiveMembership tenant mismatch');
    }

    const effectiveMembershipId = effectiveMembership.id?.trim();
    if (!effectiveMembershipId) {
      throw new BadRequestException('membershipId is required');
    }

    return {
      tenantId,
      membershipId: effectiveMembershipId,
      roles: effectiveMembership.roles.slice(),
    };
  }

  const membershipId = req.user?.membershipId?.trim();
  if (!membershipId) {
    throw new BadRequestException('membershipId is required');
  }

  return {
    tenantId,
    membershipId,
    roles: req.user?.roles?.slice() ?? [],
  };
}
