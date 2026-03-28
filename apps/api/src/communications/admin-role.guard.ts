import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedRequest } from '../common/types/request.types';

/** Admin roles — mirrors ADMIN_ROLES in @buildingos/contracts */
export const ADMIN_ROLES = ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'] as const;

/**
 * AdminRoleGuard: Restricts access to admin roles (TENANT_ADMIN, TENANT_OWNER, OPERATOR).
 * Used on communications endpoints that require admin privileges.
 */
@Injectable()
export class AdminRoleGuard implements CanActivate {
  /**
   * Check if the current user has an admin role.
   *
   * @param context - NestJS execution context
   * @returns true if user has an admin role
   * @throws ForbiddenException if user lacks admin role
   */
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userRoles: string[] = req.user?.roles ?? [];
    const isAdmin = userRoles.some((r) => ADMIN_ROLES.includes(r as typeof ADMIN_ROLES[number]));
    if (!isAdmin) {
      throw new ForbiddenException('Only administrators can perform this action');
    }
    return true;
  }
}
