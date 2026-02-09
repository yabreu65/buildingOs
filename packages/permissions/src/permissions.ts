import type { Role, Permission } from "@buildingos/contracts";

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: [
    "properties.read","properties.write",
    "units.read","units.write",
    "payments.submit","payments.review",
    "expenses.read","expenses.write",
    "tickets.create","tickets.manage",
    "communications.read","communications.publish",
  ],
  TENANT_OWNER: [
    "properties.read","properties.write",
    "units.read","units.write",
    "payments.review",
    "expenses.read","expenses.write",
    "tickets.manage",
    "communications.read","communications.publish",
  ],
  TENANT_ADMIN: [
    "properties.read","properties.write",
    "units.read","units.write",
    "payments.review",
    "expenses.read","expenses.write",
    "tickets.manage",
    "communications.read","communications.publish",
  ],
  OPERATOR: [
    "properties.read",
    "units.read",
    "payments.review",
    "tickets.manage",
    "communications.read",
  ],
  RESIDENT: [
    "properties.read",
    "units.read",
    "payments.submit",
    "expenses.read",
    "tickets.create",
    "communications.read",
  ],
};
