/**
 * User context: active building/unit per tenant
 */
export type UserContext = {
  tenantId: string;
  activeBuildingId?: string | null;
  activeUnitId?: string | null;
};

/**
 * Context option for building/unit selection
 */
export type ContextOption = {
  id: string;
  name?: string;
  code?: string;
  label?: string;
};

/**
 * Available context options (buildings and units per building)
 */
export type ContextOptions = {
  buildings: ContextOption[];
  unitsByBuilding: Record<string, ContextOption[]>;
};
