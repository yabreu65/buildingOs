import type { Role } from '@buildingos/contracts';

export type { Role };
 
 export type Session = {
   userId: string;
   role: Role;
   tenantIds: string[];
   activeTenantId: string;
 };
