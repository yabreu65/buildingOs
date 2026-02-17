 export type Permission =
   | "properties.read"
   | "properties.write"
   | "units.read"
   | "units.write"
   | "payments.submit"
   | "payments.review";
 
 export type Role = "SUPER_ADMIN" | "TENANT_OWNER" | "TENANT_ADMIN" | "OPERATOR" | "RESIDENT";
