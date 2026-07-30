import type { PortalContext } from './types/request.types';

const PRIVILEGED_ROLES = ['SUPER_ADMIN', 'TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'] as const;

export function normalizePortalContextHeader(
  value: string | undefined | null,
): PortalContext | undefined {
  if (value === 'resident' || value === 'admin') {
    return value;
  }

  return undefined;
}

export function resolveNotificationPortalContext(
  userRoles: readonly string[],
  portalContext?: PortalContext,
): PortalContext {
  const hasResidentRole = userRoles.includes('RESIDENT');
  const hasPrivilegedRole = userRoles.some((role) => PRIVILEGED_ROLES.includes(role as typeof PRIVILEGED_ROLES[number]));

  if (hasResidentRole && !hasPrivilegedRole) {
    return 'resident';
  }

  if (!hasResidentRole) {
    return 'admin';
  }

  return portalContext === 'resident' ? 'resident' : 'admin';
}

export function hasAdministrativePortalAccess(
  userRoles: readonly string[],
  portalContext?: string,
): boolean {
  const normalizedPortalContext = normalizePortalContextHeader(portalContext);
  if (portalContext !== undefined && normalizedPortalContext === undefined) {
    return false;
  }

  const hasPrivilegedRole = userRoles.some((role) =>
    PRIVILEGED_ROLES.includes(role as typeof PRIVILEGED_ROLES[number]),
  );

  if (!hasPrivilegedRole) {
    return false;
  }

  if (normalizedPortalContext === 'resident') {
    return false;
  }

  return true;
}
