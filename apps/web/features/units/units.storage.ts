import { emitBoStorageChange } from '@/shared/lib/storage/events';
import type { Unit, CreateUnitInput, UpdateUnitInput } from './units.types';

const getStorageKey = (tenantId: string) => `bo_units_${tenantId}`;

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
 * Normaliza string para unicidad (trim + lowercase)
 */
function normalize(str?: string): string {
  return (str || '').trim().toLowerCase();
}

/**
 * Migra unidades de estructura vieja (con residentName o sin buildingId)
 * Garantiza que el building default existe antes de asignar IDs
 */
function migrateOldUnits(tenantId: string, raw: Unit[]): Unit[] {
  const now = new Date().toISOString();
  const needsMigration = raw.some(
    (u: any) => u.residentName !== undefined || !u.buildingId
  );

  if (!needsMigration) return raw;

  console.log(`[Units] Detectada estructura vieja, ejecutando migración para tenant ${tenantId}`);

  // Importar dinámicamente para evitar circular dependencies
  const { listBuildings, seedBuildingsIfEmpty } = require('./buildings.storage');

  // 1. Asegurar que existe al menos un building
  seedBuildingsIfEmpty(tenantId);

  // 2. Obtener buildings reales después de seed
  const buildings = listBuildings(tenantId);

  // 3. Usar el primer building real como default (garantizado por seed)
  const defaultBuildingId = buildings.length > 0
    ? buildings[0].id
    : `building_default_${tenantId}`;

  return raw.map((u: any) => ({
    id: u.id,
    tenantId: u.tenantId,
    buildingId: u.buildingId || defaultBuildingId,
    label: u.label,
    unitCode: u.unitCode,
    unitType: u.unitType,
    occupancyStatus: u.occupancyStatus,
    createdAt: u.createdAt,
    updatedAt: now,
    // residentName is intentionally dropped
  }));
}

/**
 * Obtiene todas las unidades del tenant (con migración automática si hay data vieja)
 */
export function listUnits(tenantId: string): Unit[] {
  if (typeof window === 'undefined') return [];
  const raw = safeParseArray<Unit>(localStorage.getItem(getStorageKey(tenantId)));

  // Ejecutar migración si es necesario
  const migrated = migrateOldUnits(tenantId, raw);

  // Guardar si hubo cambios
  if (migrated !== raw) {
    localStorage.setItem(getStorageKey(tenantId), JSON.stringify(migrated));
  }

  return migrated;
}

/**
 * Obtiene unidades de un edificio
 */
export function listUnitsByBuilding(tenantId: string, buildingId: string): Unit[] {
  return listUnits(tenantId).filter((u) => u.buildingId === buildingId);
}

/**
 * Obtiene una unidad por ID
 */
export function getUnitById(tenantId: string, unitId: string): Unit | null {
  return listUnits(tenantId).find((u) => u.id === unitId) || null;
}

/**
 * Valida unicidad de label dentro de un edificio
 */
function isLabelUniqueInBuilding(
  tenantId: string,
  buildingId: string,
  label: string,
  excludeUnitId?: string,
): boolean {
  const units = listUnitsByBuilding(tenantId, buildingId);
  const normalizedLabel = normalize(label);

  return !units.some(
    (u) => normalize(u.label) === normalizedLabel && (!excludeUnitId || u.id !== excludeUnitId),
  );
}

/**
 * Valida unicidad de unitCode dentro de un edificio (si existe)
 */
function isUnitCodeUniqueInBuilding(
  tenantId: string,
  buildingId: string,
  unitCode: string | undefined,
  excludeUnitId?: string,
): boolean {
  if (!unitCode) return true; // unitCode es opcional

  const units = listUnitsByBuilding(tenantId, buildingId);
  const normalizedCode = normalize(unitCode);

  return !units.some(
    (u) =>
      u.unitCode && normalize(u.unitCode) === normalizedCode && (!excludeUnitId || u.id !== excludeUnitId),
  );
}

/**
 * Crea una unidad con validaciones
 * @throws Error si buildingId no existe o hay conflictos de unicidad
 */
export function createUnit(tenantId: string, input: CreateUnitInput): Unit {
  const units = listUnits(tenantId);

  // Validación: buildingId obligatorio
  if (!input.buildingId || input.buildingId.length === 0) {
    throw new Error('buildingId es obligatorio');
  }

  // Validación: label obligatorio
  if (!input.label || input.label.length === 0) {
    throw new Error('Label es obligatorio');
  }

  // 1. Limpiar label (trim)
  const cleanedLabel = input.label.trim();

  // 2. Limpiar unitCode (vacío → undefined)
  const cleanedUnitCode = input.unitCode?.trim() || undefined;

  // Validación: label único en el building (después de limpiar)
  if (!isLabelUniqueInBuilding(tenantId, input.buildingId, cleanedLabel)) {
    throw new Error(
      `Ya existe una unidad con el label "${cleanedLabel}" en este edificio (se diferencia solo por mayúscula)`,
    );
  }

  // Validación: unitCode único en el building (si se proporciona)
  if (!isUnitCodeUniqueInBuilding(tenantId, input.buildingId, cleanedUnitCode)) {
    throw new Error(
      `Ya existe una unidad con el código "${cleanedUnitCode}" en este edificio (se diferencia solo por mayúscula)`,
    );
  }

  const now = new Date().toISOString();
  const newUnit: Unit = {
    id: `unit_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    tenantId,
    buildingId: input.buildingId,
    label: cleanedLabel,
    unitCode: cleanedUnitCode,
    unitType: input.unitType,
    occupancyStatus: input.occupancyStatus,
    createdAt: now,
    updatedAt: now,
  };

  localStorage.setItem(getStorageKey(tenantId), JSON.stringify([...units, newUnit]));
  emitBoStorageChange();

  return newUnit;
}

/**
 * Actualiza una unidad con validaciones
 */
export function updateUnit(tenantId: string, unitId: string, input: UpdateUnitInput): Unit {
  const units = listUnits(tenantId);
  const unit = units.find((u) => u.id === unitId);

  if (!unit) {
    throw new Error(`Unidad ${unitId} no encontrada`);
  }

  // 1. Limpiar label si se proporciona (trim)
  const cleanedLabel = input.label?.trim();

  // 2. Limpiar unitCode si se proporciona (vacío → undefined)
  const cleanedUnitCode = input.unitCode !== undefined ? (input.unitCode.trim() || undefined) : undefined;

  // Validación: label único en el building (si se actualiza)
  if (cleanedLabel && !isLabelUniqueInBuilding(tenantId, unit.buildingId, cleanedLabel, unitId)) {
    throw new Error(
      `Ya existe una unidad con el label "${cleanedLabel}" en este edificio (se diferencia solo por mayúscula)`,
    );
  }

  // Validación: unitCode único en el building (si se actualiza)
  if (cleanedUnitCode !== undefined && !isUnitCodeUniqueInBuilding(tenantId, unit.buildingId, cleanedUnitCode, unitId)) {
    throw new Error(
      `Ya existe una unidad con el código "${cleanedUnitCode}" en este edificio (se diferencia solo por mayúscula)`,
    );
  }

  const updated: Unit = {
    ...unit,
    ...(cleanedLabel !== undefined && { label: cleanedLabel }),
    ...(cleanedUnitCode !== undefined && { unitCode: cleanedUnitCode }),
    ...(input.unitType !== undefined && { unitType: input.unitType }),
    ...(input.occupancyStatus !== undefined && { occupancyStatus: input.occupancyStatus }),
    updatedAt: new Date().toISOString(),
  };

  const newUnits = units.map((u) => (u.id === unitId ? updated : u));
  localStorage.setItem(getStorageKey(tenantId), JSON.stringify(newUnits));
  emitBoStorageChange();

  return updated;
}

/**
 * Elimina una unidad (hard delete en MVP)
 * @throws Error si tiene residente activo
 */
export function deleteUnit(tenantId: string, unitId: string): void {
  // Validar que la unidad existe
  const unit = getUnitById(tenantId, unitId);
  if (!unit) {
    throw new Error(`Unidad ${unitId} no encontrada`);
  }

  // Verificar si tiene residente activo (importar dinámicamente)
  const { getActiveResident } = require('./unitResidents.storage');
  const activeResident = getActiveResident(tenantId, unitId);
  if (activeResident) {
    throw new Error(
      `No se puede eliminar unidad con residente activo. Desasigne primero el residente.`
    );
  }

  const units = listUnits(tenantId);
  const filtered = units.filter((u) => u.id !== unitId);

  localStorage.setItem(getStorageKey(tenantId), JSON.stringify(filtered));
  emitBoStorageChange();
}
