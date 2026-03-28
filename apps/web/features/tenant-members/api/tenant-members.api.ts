import { apiClient } from '@/shared/lib/http/client';

export interface TenantMember {
  id: string;
  tenantId: string;
  userId?: string;
  name: string;
  email?: string;
  phone?: string;
  role: 'RESIDENT' | 'OPERATOR' | 'TENANT_ADMIN' | 'TENANT_OWNER';
  status: 'DRAFT' | 'PENDING_INVITE' | 'ACTIVE' | 'DISABLED';
  createdAt: string;
  updatedAt: string;
  disabledAt?: string;
  notes?: string;
}

export interface AssignableResident {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role: 'RESIDENT' | 'OPERATOR' | 'TENANT_ADMIN' | 'TENANT_OWNER';
  status: 'DRAFT' | 'PENDING_INVITE' | 'ACTIVE' | 'DISABLED';
  assignedUnits: number;
  isPrimaryIn: string[];
}

export interface TenantInvitation {
  id: string;
  token: string;
  expiresAt: string;
}

export interface CreateMemberInput {
  name: string;
  email?: string;
  phone?: string;
  role?: 'RESIDENT' | 'OPERATOR';
  notes?: string;
}

export interface UpdateMemberInput {
  name?: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}

export interface InviteMemberInput {
  force?: boolean;
}

export const tenantMembersApi = {
  /**
   * Create a new tenant member (starts in DRAFT status)
   */
  createMember: async (tenantId: string, input: CreateMemberInput): Promise<TenantMember> => {
    return apiClient<TenantMember, CreateMemberInput>({
      path: `/tenants/${tenantId}/members`,
      method: 'POST',
      body: input,
    });
  },

  /**
   * Update tenant member details
   */
  updateMember: async (
    tenantId: string,
    memberId: string,
    input: UpdateMemberInput,
  ): Promise<TenantMember> => {
    return apiClient<TenantMember, UpdateMemberInput>({
      path: `/tenants/${tenantId}/members/${memberId}`,
      method: 'PATCH',
      body: input,
    });
  },

  /**
   * Send invitation to member (requires email or phone)
   */
  inviteMember: async (
    tenantId: string,
    memberId: string,
    force?: boolean,
  ): Promise<TenantInvitation> => {
    return apiClient<TenantInvitation, InviteMemberInput>({
      path: `/tenants/${tenantId}/members/${memberId}/invite`,
      method: 'POST',
      body: { force: force || false },
    });
  },

  /**
   * Get members assignable to units (not DISABLED, status is DRAFT/PENDING/ACTIVE)
   */
  getAssignableResidents: async (
    tenantId: string,
    unitId?: string,
  ): Promise<AssignableResident[]> => {
    const params = new URLSearchParams();
    if (unitId) params.append('unitId', unitId);
    const queryString = params.toString();
    const url = `/tenants/${tenantId}/members/assignable${queryString ? `?${queryString}` : ''}`;
    return apiClient<AssignableResident[]>({
      path: url,
      method: 'GET',
    });
  },

  /**
   * Get single member by ID
   */
  getMember: async (tenantId: string, memberId: string): Promise<TenantMember> => {
    return apiClient<TenantMember>({
      path: `/tenants/${tenantId}/members/${memberId}`,
      method: 'GET',
    });
  },

  /**
   * List all members in tenant with optional status filter
   */
  listMembers: async (
    tenantId: string,
    status?: 'DRAFT' | 'PENDING_INVITE' | 'ACTIVE' | 'DISABLED',
  ): Promise<TenantMember[]> => {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    const queryString = params.toString();
    const url = `/tenants/${tenantId}/members${queryString ? `?${queryString}` : ''}`;
    return apiClient<TenantMember[]>({
      path: url,
      method: 'GET',
    });
  },

  /**
   * Delete a tenant member
   */
  deleteMember: async (tenantId: string, memberId: string): Promise<TenantMember> => {
    return apiClient<TenantMember>({
      path: `/tenants/${tenantId}/members/${memberId}`,
      method: 'DELETE',
    });
  },
};
