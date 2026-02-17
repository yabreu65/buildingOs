 import type { Permission, Role } from "./rbac.types";
 
 const base: Record<Role, Permission[]> = {
   SUPER_ADMIN: ["properties.read", "properties.write", "units.read", "units.write", "payments.submit", "payments.review"],
   TENANT_OWNER: ["properties.read", "properties.write", "units.read", "units.write", "payments.submit", "payments.review"],
   TENANT_ADMIN: ["properties.read", "properties.write", "units.read", "units.write", "payments.submit", "payments.review"],
   OPERATOR: ["properties.read", "units.read", "payments.review"],
   RESIDENT: ["properties.read", "units.read", "payments.submit"],
 };
 
 export function can(role: Role, permission: Permission) {
   return base[role]?.includes(permission) ?? false;
 }
