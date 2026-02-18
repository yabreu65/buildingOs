import { apiClient } from '@/shared/lib/http/client';

export interface CreateInvitationRequest {
  email: string;
  roles: string[];
}

export interface CreateInvitationResponse {
  id: string;
  email: string;
  expiresAt: string;
}

export interface ValidateTokenResponse {
  tenantId: string;
  email: string;
  expiresAt: string;
}

export interface AcceptInvitationRequest {
  token: string;
  name?: string;
  password?: string;
}

export interface Member {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  roles: string[];
}

export interface PendingInvitation {
  id: string;
  email: string;
  roles: string[];
  expiresAt: string;
  createdAt: string;
}

export const invitationsApi = {
  /**
   * Validate invitation token (public)
   */
  async validateToken(token: string): Promise<ValidateTokenResponse> {
    return apiClient<ValidateTokenResponse>({
      path: `/invitations/validate?token=${encodeURIComponent(token)}`,
      method: 'GET',
    });
  },

  /**
   * Accept invitation (public)
   */
  async acceptInvitation(
    dto: AcceptInvitationRequest,
  ): Promise<any> {
    // This is like auth/login, returns { accessToken, user, memberships }
    return apiClient({
      path: '/invitations/accept',
      method: 'POST',
      body: dto,
    });
  },

  /**
   * Create invitation (admin)
   */
  async createInvitation(
    tenantId: string,
    dto: CreateInvitationRequest,
  ): Promise<CreateInvitationResponse> {
    return apiClient<CreateInvitationResponse, CreateInvitationRequest>({
      path: `/tenants/${tenantId}/memberships/invitations`,
      method: 'POST',
      body: dto,
    });
  },

  /**
   * List members (admin)
   */
  async listMembers(tenantId: string): Promise<Member[]> {
    return apiClient<Member[]>({
      path: `/tenants/${tenantId}/memberships`,
      method: 'GET',
    });
  },

  /**
   * List pending invitations (admin)
   */
  async listInvitations(tenantId: string): Promise<PendingInvitation[]> {
    return apiClient<PendingInvitation[]>({
      path: `/tenants/${tenantId}/memberships/invitations`,
      method: 'GET',
    });
  },

  /**
   * Revoke invitation (admin)
   */
  async revokeInvitation(tenantId: string, invitationId: string): Promise<any> {
    return apiClient({
      path: `/tenants/${tenantId}/memberships/invitations/${invitationId}`,
      method: 'DELETE',
    });
  },

  /**
   * Resend invitation with new token (admin)
   */
  async resendInvitation(
    tenantId: string,
    invitationId: string,
  ): Promise<CreateInvitationResponse> {
    return apiClient<CreateInvitationResponse>({
      path: `/tenants/${tenantId}/memberships/invitations/${invitationId}/resend`,
      method: 'POST',
    });
  },
};
