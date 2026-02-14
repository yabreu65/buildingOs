import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';

export interface RequestWithUser extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    isSuperAdmin?: boolean;
    memberships?: Array<{
      tenantId: string;
      roles: string[];
    }>;
  };
}

/**
 * SuperAdminGuard: Validates JWT token and verifies user has SUPER_ADMIN role.
 *
 * SECURITY:
 * - Requires valid JWT (enforced by JwtAuthGuard first)
 * - Checks isSuperAdmin flag in JWT payload OR validates membership has SUPER_ADMIN role
 * - Uses belt + suspenders approach for security
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    // Check JWT present
    if (!user) {
      throw new UnauthorizedException('JWT token required');
    }

    // Strategy 1: Check isSuperAdmin flag (from JWT payload)
    const hasSuperAdminViaJWT = user.isSuperAdmin === true;

    // Strategy 2: Check memberships (fallback if JWT is stale)
    const hasSuperAdminViaMembership =
      user.memberships &&
      user.memberships.some((m) => m.roles.includes('SUPER_ADMIN'));

    // Accept if EITHER strategy succeeds (belt + suspenders)
    const isSuperAdmin = hasSuperAdminViaJWT || hasSuperAdminViaMembership;

    if (!isSuperAdmin) {
      throw new ForbiddenException(
        'SUPER_ADMIN role required. Your account does not have permission to access this resource.',
      );
    }

    return true;
  }
}
