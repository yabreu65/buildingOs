import type { Role, ScopeType, ScopedRole } from '@buildingos/contracts';

export type { Role, ScopeType, ScopedRole };

export interface Membership {
  id?: string;
  tenantId: string;
  roles: Role[];
  scopedRoles?: ScopedRole[];
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface LoginResponse {
  user: AuthUser;
  memberships: Membership[];
}

export interface AuthSession {
  user: AuthUser;
  memberships: Membership[];
  activeTenantId: string;
}
