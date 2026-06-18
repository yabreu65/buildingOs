import { ROLE_PERMISSIONS } from '@buildingos/permissions';
import type { Role } from './rbac.types';

export function can(role: Role, permission: string) {
  return (ROLE_PERMISSIONS[role] as readonly string[] | undefined)?.includes(permission) ?? false;
}
