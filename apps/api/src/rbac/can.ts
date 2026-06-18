import type { Permission, Role } from './permissions';
import { PERMISSIONS } from './permissions';

export function can(roles: string[], permission: Permission): boolean {
  return roles.some((role) => {
    const rolePermissions = PERMISSIONS[role as Role] || [];
    return rolePermissions.includes(permission);
  });
}
