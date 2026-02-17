import { emitBoStorageChange } from '@/shared/lib/storage/events';
import type { Tenant, CreateTenantInput, UpdateTenantInput, PlanLimits, TenantStats, GlobalStats } from './super-admin.types';

// ============================================
// Constants
// ============================================
const getStorageKey = () => 'bo_tenants';

export const PLAN_TYPES = ['FREE', 'BASIC', 'PRO', 'ENTERPRISE'] as const;
export const TENANT_TYPES = ['ADMINISTRADORA', 'EDIFICIO_AUTOGESTION'] as const;
export const TENANT_STATUSES = ['TRIAL', 'ACTIVE', 'SUSPENDED'] as const;

export const PLAN_LABELS: Record<string, string> = {
  FREE: 'Gratuito',
  BASIC: 'Básico',
  PRO: 'Profesional',
  ENTERPRISE: 'Enterprise',
};

export const TENANT_TYPE_LABELS: Record<string, string> = {
  ADMINISTRADORA: 'Empresa inmobiliaria',
  EDIFICIO_AUTOGESTION: 'Consorcio individual',
};

export const TENANT_STATUS_LABELS: Record<string, string> = {
  TRIAL: 'Prueba',
  ACTIVE: 'Activo',
  SUSPENDED: 'Suspendido',
};

function safeParseArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * Calcula los límites de un plan
 */
export function calculateLimits(plan: string): PlanLimits {
  switch (plan) {
    case 'FREE':
      return { buildings: 1, units: 10, users: 20 };
    case 'BASIC':
      return { buildings: 5, units: 50, users: 100 };
    case 'PRO':
      return { buildings: 20, units: 500, users: 500 };
    case 'ENTERPRISE':
      return { buildings: 999, units: 9999, users: 9999 };
    default:
      return { buildings: 1, units: 10, users: 20 };
  }
}

/**
 * Obtiene todos los tenants
 */
export function listTenants(): Tenant[] {
  if (typeof window === 'undefined') return [];
  return safeParseArray<Tenant>(localStorage.getItem(getStorageKey()));
}

/**
 * Obtiene un tenant por ID
 */
export function getTenantById(tenantId: string): Tenant | null {
  return listTenants().find((t) => t.id === tenantId) || null;
}

/**
 * Crea un nuevo tenant
 */
export function createTenant(input: CreateTenantInput): Tenant {
  const tenants = listTenants();
  const now = new Date().toISOString();

  const newTenant: Tenant = {
    id: `tenant_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    name: input.name.trim(),
    type: input.type,
    status: 'TRIAL', // default para nuevos tenants
    plan: input.plan,
    createdAt: now,
    limits: calculateLimits(input.plan),
  };

  const updated = [...tenants, newTenant];
  localStorage.setItem(getStorageKey(), JSON.stringify(updated));
  emitBoStorageChange();

  return newTenant;
}

/**
 * Actualiza un tenant
 */
export function updateTenant(tenantId: string, input: UpdateTenantInput): Tenant {
  const tenants = listTenants();
  const tenant = tenants.find((t) => t.id === tenantId);

  if (!tenant) {
    throw new Error(`Tenant ${tenantId} no encontrado`);
  }

  const updated: Tenant = {
    ...tenant,
    ...(input.name && { name: input.name.trim() }),
    ...(input.plan && { plan: input.plan, limits: calculateLimits(input.plan) }),
    ...(input.status && { status: input.status }),
    updatedAt: new Date().toISOString(),
  };

  const newTenants = tenants.map((t) => (t.id === tenantId ? updated : t));
  localStorage.setItem(getStorageKey(), JSON.stringify(newTenants));
  emitBoStorageChange();

  return updated;
}

/**
 * Elimina un tenant (hard delete)
 */
export function deleteTenant(tenantId: string): void {
  const tenants = listTenants();
  const filtered = tenants.filter((t) => t.id !== tenantId);
  localStorage.setItem(getStorageKey(), JSON.stringify(filtered));
  emitBoStorageChange();
}

/**
 * Obtiene stats de un tenant específico
 */
export function getTenantStats(tenantId: string): TenantStats {
  // TODO: Integrar con buildings.storage y units.storage cuando esté disponible
  // Por ahora retorna estructura base
  return {
    buildingsCount: 0,
    unitsCount: 0,
    usersCount: 0,
  };
}

/**
 * Valida si un tenant puede hacer ciertas operaciones basado en plan
 */
export function validateTenantLimits(tenantId: string, operation: 'building' | 'unit' | 'user'): boolean {
  const tenant = getTenantById(tenantId);
  if (!tenant) return false;

  const stats = getTenantStats(tenantId);
  const limits = tenant.limits || calculateLimits(tenant.plan);

  switch (operation) {
    case 'building':
      return stats.buildingsCount < limits.buildings;
    case 'unit':
      return stats.unitsCount < limits.units;
    case 'user':
      return stats.usersCount < limits.users;
    default:
      return false;
  }
}

/**
 * Obtiene stats globales (para Overview dashboard)
 */
export function getGlobalStats(): GlobalStats {
  const tenants = listTenants();
  const activeTenants = tenants.filter((t) => t.status === 'ACTIVE').length;
  const trialTenants = tenants.filter((t) => t.status === 'TRIAL').length;
  const suspendedTenants = tenants.filter((t) => t.status === 'SUSPENDED').length;

  // TODO: Calcular totales de buildings/units/residents cuando exista data
  return {
    totalTenants: tenants.length,
    activeTenants,
    trialTenants,
    suspendedTenants,
    totalBuildings: 0,
    totalUnits: 0,
    totalResidents: 0,
  };
}

/**
 * Busca tenants por nombre (case-insensitive)
 */
export function searchTenants(query: string): Tenant[] {
  const tenants = listTenants();
  const normalizedQuery = query.toLowerCase().trim();

  if (!normalizedQuery) return tenants;

  return tenants.filter((tenant) => tenant.name.toLowerCase().includes(normalizedQuery));
}

/**
 * Filtra tenants por status
 */
export function filterTenantsByStatus(status: string): Tenant[] {
  return listTenants().filter((tenant) => tenant.status === status);
}

/**
 * Filtra tenants por plan
 */
export function filterTenantsByPlan(plan: string): Tenant[] {
  return listTenants().filter((tenant) => tenant.plan === plan);
}

/**
 * Obtiene tenants agrupados por status
 */
export function getTenantsByStatus(): Record<string, Tenant[]> {
  const tenants = listTenants();
  return {
    ACTIVE: tenants.filter((t) => t.status === 'ACTIVE'),
    TRIAL: tenants.filter((t) => t.status === 'TRIAL'),
    SUSPENDED: tenants.filter((t) => t.status === 'SUSPENDED'),
  };
}

/**
 * Obtiene tenants ordenados por fecha (más recientes primero)
 */
export function getRecentTenants(limit = 10): Tenant[] {
  const tenants = listTenants();
  return tenants
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

/**
 * Seed: crear tenants de demo si no existen
 */
export function seedSuperAdminIfEmpty(): void {
  const tenants = listTenants();
  if (tenants.length > 0) return;

  console.log('[SuperAdmin] Seeding demo tenants');

  const demoTenants: CreateTenantInput[] = [
    {
      name: 'Acme Corporation',
      type: 'ADMINISTRADORA',
      plan: 'PRO',
      ownerEmail: 'admin@acme.com',
    },
    {
      name: 'Condominio Flores',
      type: 'EDIFICIO_AUTOGESTION',
      plan: 'BASIC',
      ownerEmail: 'admin@flores.com',
    },
    {
      name: 'Plaza Torres',
      type: 'ADMINISTRADORA',
      plan: 'ENTERPRISE',
      ownerEmail: 'admin@plazatorres.com',
    },
  ];

  for (const input of demoTenants) {
    createTenant(input);
  }
}
