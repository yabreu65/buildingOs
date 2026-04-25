import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthenticatedRequest } from '../types/request.types';

interface ResolveTenantContextOptions {
  tenantIdParam?: string;
  allowHeaderFallback?: boolean;
  allowSingleMembershipFallback?: boolean;
  requireMembership?: boolean;
}

function normalizeHeaderTenantId(value: string | string[] | undefined): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    const candidate = value.find((item) => typeof item === 'string' && item.trim().length > 0);
    return candidate ? candidate.trim() : null;
  }

  return null;
}

/**
 * Resolve tenantId from trusted request context sources and optionally enforce membership access.
 */
export function resolveTenantId(
  req: AuthenticatedRequest,
  options: ResolveTenantContextOptions = {},
): string {
  const {
    tenantIdParam = 'tenantId',
    allowHeaderFallback = false,
    allowSingleMembershipFallback = false,
    requireMembership = true,
  } = options;

  const params = (req as AuthenticatedRequest & { params?: Record<string, string | undefined> }).params;
  const tenantFromParam = params?.[tenantIdParam];
  const tenantFromRequest = req.tenantId;
  const tenantFromUser = req.user?.tenantId;
  const tenantFromHeader = normalizeHeaderTenantId(req.headers['x-tenant-id']);

  const memberships = req.user?.memberships ?? [];
  const tenantFromSingleMembership =
    allowSingleMembershipFallback && memberships.length === 1
      ? memberships[0]?.tenantId
      : null;

  const tenantId =
    tenantFromRequest ||
    tenantFromParam ||
    tenantFromUser ||
    tenantFromSingleMembership ||
    (allowHeaderFallback ? tenantFromHeader : null);

  if (!tenantId) {
    throw new BadRequestException('Tenant context required');
  }

  if (requireMembership) {
    const hasMembership = memberships.some(
      (membership) => membership.tenantId === tenantId,
    );

    if (!hasMembership) {
      throw new ForbiddenException(`No tiene acceso al tenant ${tenantId}`);
    }
  }

  return tenantId;
}
