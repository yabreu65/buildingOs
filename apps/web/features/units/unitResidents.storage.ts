import { emitBoStorageChange } from '@/shared/lib/storage/events';
import type { UnitResident } from './units.types';

const getStorageKey = (tenantId: string) => `bo_unit_residents_${tenantId}`;

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
 * Obtiene todos los residentes del tenant
 */
function listAllUnitResidents(tenantId: string): UnitResident[] {
  if (typeof window === 'undefined') return [];
  return safeParseArray<UnitResident>(localStorage.getItem(getStorageKey(tenantId)));
}

/**
 * Obtiene residentes de una unidad (activos e históricos)
 */
export function listUnitResidents(tenantId: string, unitId: string): UnitResident[] {
  return listAllUnitResidents(tenantId).filter((ur) => ur.unitId === unitId);
}

/**
 * Obtiene el residente ACTIVO de una unidad (endAt == null)
 * Si hay múltiples, retorna el isPrimary==true (o el primero si hay inconsistencia)
 */
export function getActiveResident(tenantId: string, unitId: string): UnitResident | null {
  const residents = listUnitResidents(tenantId, unitId).filter((ur) => !ur.endAt);

  if (residents.length === 0) return null;
  if (residents.length === 1) return residents[0];

  // Múltiples activos: priorizar isPrimary
  const primary = residents.find((ur) => ur.isPrimary);
  if (primary) {
    console.warn(`[UnitResidents] Multiple active residents for unit ${unitId}, using isPrimary`);
    return primary;
  }

  return residents[0];
}

/**
 * Asigna un residente a una unidad
 * Si hay residente activo, primero lo desactiva (endAt = now)
 */
export function assignResident(
  tenantId: string,
  unitId: string,
  residentUserId: string,
  relationType: UnitResident['relationType'] = 'TENANT',
): UnitResident {
  const allResidents = listAllUnitResidents(tenantId);
  const now = new Date().toISOString();

  // 1. Desactivar residente anterior (si existe)
  const activeResident = getActiveResident(tenantId, unitId);
  let updated = allResidents;
  if (activeResident) {
    updated = allResidents.map((r) =>
      r.id === activeResident.id ? { ...r, endAt: now } : r
    );
  }

  // 2. Crear nuevo residente activo
  const newResident: UnitResident = {
    id: `ur_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    tenantId,
    unitId,
    residentUserId,
    relationType,
    isPrimary: true,
    startAt: now,
    endAt: null,
  };

  const finalState = [...updated, newResident];
  localStorage.setItem(getStorageKey(tenantId), JSON.stringify(finalState));
  emitBoStorageChange();

  return newResident;
}

/**
 * Desasigna el residente activo de una unidad (endAt = now)
 */
export function unassignResident(tenantId: string, unitId: string): void {
  const allResidents = listAllUnitResidents(tenantId);
  const activeResident = getActiveResident(tenantId, unitId);

  // Solo emitir y guardar si realmente había un residente activo
  if (activeResident) {
    const now = new Date().toISOString();
    const updated = allResidents.map((r) =>
      r.id === activeResident.id ? { ...r, endAt: now } : r
    );
    localStorage.setItem(getStorageKey(tenantId), JSON.stringify(updated));
    emitBoStorageChange();
  }
}
