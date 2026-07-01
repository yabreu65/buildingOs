import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/types/request.types';
import { can } from './can';
import type { Permission } from './permissions';

export const REQUIRED_TENANT_PERMISSION_KEY = 'requiredTenantPermission';

export function RequireTenantPermission(permission: Permission): MethodDecorator {
  return applyDecorators(
    SetMetadata(REQUIRED_TENANT_PERMISSION_KEY, permission),
    UseGuards(TenantPermissionGuard),
  );
}

@Injectable()
export class TenantPermissionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const permission = this.getRequiredPermission(context);
    if (!permission) {
      throw new ForbiddenException('Tenant permission requirement is missing');
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const routeTenantId = request.params.tenantId;
    const hydratedTenantId = request.tenantId;

    if (!routeTenantId || hydratedTenantId !== routeTenantId) {
      throw new ForbiddenException('Tenant context does not match the request');
    }

    const roles = request.user?.roles ?? [];
    if (!can(roles, permission)) {
      throw new ForbiddenException(
        `Missing required tenant permission: ${permission}`,
      );
    }

    return true;
  }

  private getRequiredPermission(
    context: ExecutionContext,
  ): Permission | undefined {
    return (
      Reflect.getMetadata(
        REQUIRED_TENANT_PERMISSION_KEY,
        context.getHandler(),
      ) ??
      Reflect.getMetadata(REQUIRED_TENANT_PERMISSION_KEY, context.getClass())
    );
  }
}
