import { residentDashboard, tenantDashboard } from '@/shared/lib/routes';
import type { AuthSession, Membership } from './auth.types';

export type PortalContext = 'resident' | 'admin';

export interface ResolveAuthLandingRouteParams {
  readonly session: AuthSession;
  readonly requestedPath?: string | null;
  readonly preferredTenantId?: string | null;
  readonly preferredPortal?: PortalContext | null;
}

const ADMIN_ROLES = new Set(['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR', 'SUPER_ADMIN']);
const PUBLIC_PATH_PREFIXES = ['/login', '/signup', '/health', '/demo', '/demo-guiada', '/contact', '/invite'];

function hasAdminPortalAccess(roles: readonly string[] | undefined): boolean {
  return roles?.some((role) => ADMIN_ROLES.has(role)) ?? false;
}

function hasResidentPortalAccess(roles: readonly string[] | undefined): boolean {
  return roles?.includes('RESIDENT') ?? false;
}

function parseRequestedPath(requestedPath: string): URL {
  return new URL(requestedPath, 'https://buildingos.local');
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isSuperAdminPath(pathname: string): boolean {
  return pathname === '/super-admin' || pathname.startsWith('/super-admin/');
}

function getTenantIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/([^/]+)(?:\/.*)?$/);
  if (!match) {
    return null;
  }

  const tenantId = match[1]?.trim();
  if (!tenantId || tenantId === 'login' || tenantId === 'signup' || tenantId === 'super-admin') {
    return null;
  }

  return tenantId;
}

function isResidentPath(pathname: string): boolean {
  return pathname.includes('/resident/');
}

function resolveMembershipForTenant(memberships: Membership[], tenantId?: string | null): Membership | null {
  if (!tenantId) {
    return null;
  }

  return memberships.find((membership) => membership.tenantId === tenantId) ?? null;
}

export function resolveActiveTenantId(
  memberships: Membership[],
  preferredTenantIds: Array<string | null | undefined>,
): string {
  for (const preferredTenantId of preferredTenantIds) {
    if (typeof preferredTenantId !== 'string' || preferredTenantId.trim().length === 0) {
      continue;
    }

    const match = resolveMembershipForTenant(memberships, preferredTenantId);
    if (match) {
      return match.tenantId;
    }
  }

  return memberships[0]?.tenantId ?? '';
}

export function resolvePortalFromPathname(
  pathname: string | null | undefined,
  searchParamsString?: string | null,
): PortalContext | null {
  if (!pathname || isPublicPath(pathname) || isSuperAdminPath(pathname)) {
    return null;
  }

  if (searchParamsString) {
    const searchParams = new URLSearchParams(searchParamsString);
    const portal = searchParams.get('portal');
    if (portal === 'resident' || portal === 'admin') {
      return portal;
    }
  }

  const tenantId = getTenantIdFromPathname(pathname);
  if (!tenantId) {
    return null;
  }

  return isResidentPath(pathname) ? 'resident' : 'admin';
}

function resolveAuthorizedRequestedPath(
  session: AuthSession,
  requestedPath: string,
): string | null {
  const url = parseRequestedPath(requestedPath);
  const { pathname } = url;

  if (isPublicPath(pathname) || isSuperAdminPath(pathname)) {
    return null;
  }

  const tenantId = getTenantIdFromPathname(pathname);
  if (!tenantId) {
    return null;
  }

  const membership = resolveMembershipForTenant(session.memberships, tenantId);
  if (!membership) {
    return null;
  }

  const explicitPortal = url.searchParams.get('portal');
  if (explicitPortal === 'resident') {
    return hasResidentPortalAccess(membership.roles) ? `${pathname}${url.search}` : null;
  }

  if (explicitPortal === 'admin') {
    return hasAdminPortalAccess(membership.roles) ? `${pathname}${url.search}` : null;
  }

  if (isResidentPath(pathname)) {
    return hasResidentPortalAccess(membership.roles) ? `${pathname}${url.search}` : null;
  }

  return hasAdminPortalAccess(membership.roles) ? `${pathname}${url.search}` : null;
}

function resolveFallbackPortal(
  roles: readonly string[] | undefined,
  preferredPortal: PortalContext | null | undefined,
): PortalContext {
  if (preferredPortal === 'resident' && hasResidentPortalAccess(roles)) {
    return 'resident';
  }

  if (preferredPortal === 'admin' && hasAdminPortalAccess(roles)) {
    return 'admin';
  }

  const hasResidentAccess = hasResidentPortalAccess(roles);
  const hasAdminAccess = hasAdminPortalAccess(roles);

  if (hasResidentAccess && !hasAdminAccess) {
    return 'resident';
  }

  return 'admin';
}

export function resolveAuthLandingRoute({
  session,
  requestedPath,
  preferredTenantId,
  preferredPortal,
}: ResolveAuthLandingRouteParams): string {
  if (requestedPath) {
    const authorizedRequestedPath = resolveAuthorizedRequestedPath(session, requestedPath);
    if (authorizedRequestedPath) {
      return authorizedRequestedPath;
    }
  }

  const activeTenantId = resolveActiveTenantId(session.memberships, [
    preferredTenantId,
    session.activeTenantId,
  ]);

  const activeMembership = resolveMembershipForTenant(session.memberships, activeTenantId) ?? session.memberships[0] ?? null;
  const resolvedPortal = resolveFallbackPortal(activeMembership?.roles, preferredPortal);

  return resolvedPortal === 'resident'
    ? residentDashboard(activeTenantId)
    : tenantDashboard(activeTenantId);
}
