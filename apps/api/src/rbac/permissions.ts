import type { Permission, Role } from '@buildingos/contracts';
import { ROLE_PERMISSIONS } from '@buildingos/permissions';

export type { Permission, Role } from '@buildingos/contracts';

/**
 * Temporary API-facing compatibility export.
 * Keeps existing imports stable while the canonical RBAC source lives in shared packages.
 */
export const PERMISSIONS: Record<Role, Permission[]> = ROLE_PERMISSIONS;
