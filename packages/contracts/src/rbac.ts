export type Role =
  | "SUPER_ADMIN"
  | "TENANT_OWNER"
  | "TENANT_ADMIN"
  | "OPERATOR"
  | "RESIDENT";

/** Roles with administrative privileges (can manage communications, buildings, etc.) */
export const ADMIN_ROLES = ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'] as const;
export type AdminRole = typeof ADMIN_ROLES[number];

export type Permission =
  | "properties.read"
  | "properties.write"
  | "units.read"
  | "units.write"
  | "payments.submit"
  | "payments.review"
  | "expenses.read"
  | "expenses.write"
  | "tickets.create"
  | "tickets.manage"
  | "communications.read"
  | "communications.publish";

export interface Scope {
  tenantId: string;
  propertyId?: string;
  unitId?: string;
}
