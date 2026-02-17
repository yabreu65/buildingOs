import { emitBoStorageChange } from '@/shared/lib/storage/events';
import type { Building } from './units.types';

const getStorageKey = (tenantId: string) => `bo_buildings_${tenantId}`;

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
 * Obtiene todos los edificios del tenant
 */
export function listBuildings(tenantId: string): Building[] {
  if (typeof window === 'undefined') return [];
  return safeParseArray<Building>(localStorage.getItem(getStorageKey(tenantId)));
}

/**
 * Obtiene un edificio por ID
 */
export function getBuildingById(tenantId: string, buildingId: string): Building | null {
  const buildings = listBuildings(tenantId);
  return buildings.find((b) => b.id === buildingId) || null;
}

/**
 * Crea un edificio
 */
export function createBuilding(tenantId: string, input: Omit<Building, 'id' | 'tenantId' | 'createdAt'>): Building {
  const buildings = listBuildings(tenantId);

  const newBuilding: Building = {
    id: `building_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    tenantId,
    name: input.name,
    address: input.address,
    createdAt: new Date().toISOString(),
  };

  localStorage.setItem(getStorageKey(tenantId), JSON.stringify([...buildings, newBuilding]));
  emitBoStorageChange();

  return newBuilding;
}

/**
 * Seed: crear edificios por defecto si no existen
 */
export function seedBuildingsIfEmpty(tenantId: string): void {
  const buildings = listBuildings(tenantId);
  if (buildings.length > 0) return;

  const mockBuildings: Omit<Building, 'id' | 'createdAt'>[] = [
    { tenantId, name: 'Edificio Principal', address: 'Calle Principal 123' },
    { tenantId, name: 'Edificio Secundario', address: 'Avenida Secundaria 456' },
    { tenantId, name: 'Complejo Residencial A', address: 'Zona A' },
  ];

  for (const building of mockBuildings) {
    createBuilding(tenantId, building);
  }
}
