import { Request } from 'express';
import type { Role, ScopedRole } from '@buildingos/contracts';

export interface AuthenticatedMembership {
  id?: string;
  tenantId: string;
  roles: Role[];
  scopedRoles?: ScopedRole[];
}

export interface AuthenticatedUser {
  id: string;
  sub?: string;
  email: string;
  name?: string;
  isSuperAdmin?: boolean;
  role?: Role;
  roles?: Role[];
  membershipId?: string;
  permissions?: string[];
  tenantId?: string; // From JWT context for tenant-level routes
  memberships?: AuthenticatedMembership[];
  effectiveMembership?: AuthenticatedMembership;
}

export interface AuthenticatedServiceActor
  extends Pick<AuthenticatedUser, 'id' | 'memberships'> {}

/**
 * Request type with typed tenantId, userId, and user properties
 * Used across all controllers that require authentication
 *
 * Note: tenantId can come from two sources:
 * - JWT context (req.user.tenantId) for tenant-level endpoints
 * - BuildingAccessGuard (req.tenantId) for building-scoped endpoints
 */
export interface AuthenticatedRequest extends Request {
  tenantId?: string; // Populated by BuildingAccessGuard for building-scoped routes
  userId?: string;
  user: AuthenticatedUser;
}

/**
 * Request with tenant context populated by BuildingAccessGuard
 */
export interface TenantContextRequest extends AuthenticatedRequest {
  tenantId: string;
}

/**
 * Request with both tenant and building context
 */
export interface BuildingContextRequest extends TenantContextRequest {
  buildingId?: string;
}
