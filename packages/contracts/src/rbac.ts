export type Role =
  | "SUPER_ADMIN"
  | "TENANT_OWNER"
  | "TENANT_ADMIN"
  | "OPERATOR"
  | "RESIDENT";

/** Roles with administrative privileges (can manage communications, buildings, etc.) */
export const ADMIN_ROLES = ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'] as const;
export type AdminRole = typeof ADMIN_ROLES[number];

export type ScopeType = "TENANT" | "BUILDING" | "UNIT";

export type Permission =
  | "buildings.read"
  | "buildings.write"
  | "units.read"
  | "units.write"
  | "payments.submit"
  | "payments.review"
  | "tickets.read"
  | "tickets.write"
  | "tickets.manage"
  | "members.manage";

export interface ScopedRole {
  id: string;
  role: Role;
  scopeType: ScopeType;
  scopeBuildingId: string | null;
  scopeUnitId: string | null;
}

export interface TenantMembershipRoles {
  id?: string;
  tenantId: string;
  roles: Role[];
  scopedRoles?: ScopedRole[];
}

export interface Scope {
  tenantId: string;
  buildingId?: string;
  unitId?: string;
}
