export type Role =
  | "SUPER_ADMIN"
  | "TENANT_OWNER"
  | "TENANT_ADMIN"
  | "OPERATOR"
  | "RESIDENT";

export type Membership = {
  tenantId: string;
  roles: Role[];
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
