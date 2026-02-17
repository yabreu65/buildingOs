 export type Role = "SUPER_ADMIN" | "TENANT_OWNER" | "TENANT_ADMIN" | "OPERATOR" | "RESIDENT";
 
 export type Session = {
   userId: string;
   role: Role;
   tenantIds: string[];
   activeTenantId: string;
 };
