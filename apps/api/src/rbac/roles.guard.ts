import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

interface RoleAwareUser {
  role?: string;
  roles?: string[];
  isSuperAdmin?: boolean;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<{ user?: RoleAwareUser }>();
    const required = requiredRoles.map((r) => r.toUpperCase());
    const userRoles = new Set<string>();

    if (user?.role) {
      userRoles.add(user.role.toUpperCase());
    }

    if (Array.isArray(user?.roles)) {
      for (const role of user.roles) {
        userRoles.add(role.toUpperCase());
      }
    }

    if (user?.isSuperAdmin) {
      userRoles.add('SUPER_ADMIN');
    }

    return required.some((role) => userRoles.has(role));
  }
}
