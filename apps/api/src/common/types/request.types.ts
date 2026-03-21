import { Request } from 'express';

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
  user: {
    id: string;
    sub?: string;
    email: string;
    roles?: string[];
    membershipId?: string;
    permissions?: string[];
    tenantId?: string; // From JWT context for tenant-level routes
  };
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
