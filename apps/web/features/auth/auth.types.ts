import type { Role, ScopeType, ScopedRole } from '@buildingos/contracts';

export type { Role, ScopeType, ScopedRole };

export type Membership = {
  id?: string;
  tenantId: string;
  roles: Role[];
  scopedRoles?: ScopedRole[];
};

export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

export type LoginResponse = {
  accessToken: string;
  user: AuthUser;
  memberships: Membership[];
};

export type AuthSession = {
  user: AuthUser;
  memberships: Membership[];
  activeTenantId: string;
};
