// ============================================
// SUPER_ADMIN Types
// ============================================

/**
 * Tenant (cliente del SaaS)
 */
export type Tenant = {
  id: string;
  name: string;
  type: 'ADMINISTRADORA' | 'EDIFICIO_AUTOGESTION';
  status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED';
  plan: 'FREE' | 'BASIC' | 'PRO' | 'ENTERPRISE';
  ownerId?: string; // user ID del TENANT_OWNER
  createdAt: string; // ISO datetime
  updatedAt?: string;
  limits?: {
    buildings: number;
    units: number;
    users: number;
  };
};

/**
 * Input para crear tenant
 */
export type CreateTenantInput = {
  name: string;
  type: 'ADMINISTRADORA' | 'EDIFICIO_AUTOGESTION';
  plan: 'FREE' | 'BASIC' | 'PRO' | 'ENTERPRISE';
  ownerEmail: string;
};

/**
 * Input para actualizar tenant
 */
export type UpdateTenantInput = Partial<{
  name: string;
  plan: 'FREE' | 'BASIC' | 'PRO' | 'ENTERPRISE';
  status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED';
}>;

/**
 * Límites por plan
 */
export type PlanLimits = {
  buildings: number;
  units: number;
  users: number;
};

/**
 * Stats del tenant
 */
export type TenantStats = {
  buildingsCount: number;
  unitsCount: number;
  usersCount: number;
};

/**
 * Global stats (para overview)
 */
export type GlobalStats = {
  totalTenants: number;
  activeTenants: number;
  trialTenants: number;
  suspendedTenants: number;
  totalBuildings: number;
  totalUnits: number;
  totalResidents: number;
};
