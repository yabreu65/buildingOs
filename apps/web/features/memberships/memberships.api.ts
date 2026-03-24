import { ScopedRole } from '../auth/auth.types';
import { apiClient } from '@/shared/lib/http/client';

export interface AddRoleInput {
  role: string;
  scopeType: 'TENANT' | 'BUILDING' | 'UNIT';
  scopeBuildingId?: string;
  scopeUnitId?: string;
}

/**
 * Get all scoped roles for a membership
 */
export async function listMemberRoles(
  tenantId: string,
  membershipId: string,
): Promise<ScopedRole[]> {
  return apiClient<ScopedRole[]>({
    path: `/tenants/${tenantId}/memberships/${membershipId}/roles`,
    method: 'GET',
  });
}

/**
 * Add a scoped role to a membership
 */
export async function addMemberRole(
  tenantId: string,
  membershipId: string,
  input: AddRoleInput,
): Promise<ScopedRole> {
  return apiClient<ScopedRole, AddRoleInput>({
    path: `/tenants/${tenantId}/memberships/${membershipId}/roles`,
    method: 'POST',
    body: input,
  });
}

/**
 * Remove a role from a membership
 */
export async function removeMemberRole(
  tenantId: string,
  membershipId: string,
  roleId: string,
): Promise<void> {
  await apiClient<void>({
    path: `/tenants/${tenantId}/memberships/${membershipId}/roles/${roleId}`,
    method: 'DELETE',
  });
}
