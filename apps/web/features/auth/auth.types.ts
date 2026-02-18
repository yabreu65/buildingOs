export type Role =
  | "SUPER_ADMIN"
  | "TENANT_OWNER"
  | "TENANT_ADMIN"
  | "OPERATOR"
  | "RESIDENT";

export type ScopeType = "TENANT" | "BUILDING" | "UNIT";

export type ScopedRole = {
  id: string;
  role: Role;
  scopeType: ScopeType;
  scopeBuildingId: string | null;
  scopeUnitId: string | null;
};

export type Membership = {
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
