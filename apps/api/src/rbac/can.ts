import { Permission, PERMISSIONS } from './permissions';

export function can(roles: string[], permission: Permission): boolean {
  return roles.some((role) => {
    const rolePermissions = PERMISSIONS[role] || [];
    return rolePermissions.includes(permission);
  });
}
