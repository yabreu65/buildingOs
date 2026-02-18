import { ScopedRole } from '../auth/auth.types';

export interface AddRoleInput {
  role: string;
  scopeType: 'TENANT' | 'BUILDING' | 'UNIT';
  scopeBuildingId?: string;
  scopeUnitId?: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

/**
 * Get all scoped roles for a membership
 */
export async function listMemberRoles(
  tenantId: string,
  membershipId: string,
): Promise<ScopedRole[]> {
  const response = await fetch(
    `${API_URL}/tenants/${tenantId}/memberships/${membershipId}/roles`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to list roles: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Add a scoped role to a membership
 */
export async function addMemberRole(
  tenantId: string,
  membershipId: string,
  input: AddRoleInput,
): Promise<ScopedRole> {
  const response = await fetch(
    `${API_URL}/tenants/${tenantId}/memberships/${membershipId}/roles`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
      },
      body: JSON.stringify(input),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to add role: ${error}`);
  }

  return response.json();
}

/**
 * Remove a role from a membership
 */
export async function removeMemberRole(
  tenantId: string,
  membershipId: string,
  roleId: string,
): Promise<void> {
  const response = await fetch(
    `${API_URL}/tenants/${tenantId}/memberships/${membershipId}/roles/${roleId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to remove role: ${response.statusText}`);
  }
}
