export type Role =
  | "SUPER_ADMIN"
  | "TENANT_OWNER"
  | "TENANT_ADMIN"
  | "OPERATOR"
  | "RESIDENT";

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

export type Scope = {
  tenantId: string;
  propertyId?: string;
  unitId?: string;
};
