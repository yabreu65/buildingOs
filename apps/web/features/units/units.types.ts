// ============================================
// Unit (Unidad de propiedad)
// ============================================
export type Unit = {
  id: string;
  tenantId: string;
  buildingId: string;
  label: string; // Ej: "Apto 101"
  unitCode?: string; // Ej: "UF-101", código externo
  unitType?: 'APARTMENT' | 'HOUSE' | 'OFFICE' | 'STORAGE' | 'PARKING' | 'OTHER';
  occupancyStatus?: 'UNKNOWN' | 'VACANT' | 'OCCUPIED';
  createdAt: string;
  updatedAt: string;
};

// ============================================
// UnitResident (Relación Unit <-> User + Historial)
// ============================================
export type UnitResident = {
  id: string;
  tenantId: string;
  unitId: string;
  residentUserId: string;
  relationType: 'OWNER' | 'TENANT' | 'OTHER';
  isPrimary: boolean;
  startAt: string; // ISO datetime
  endAt?: string | null; // null = activo, fecha = histórico
};

// ============================================
// Building (Edificio/Propiedad)
// ============================================
export type Building = {
  id: string;
  tenantId: string;
  name: string;
  address?: string;
  createdAt?: string;
};

// ============================================
// User (Usuario del sistema)
// ============================================
export type User = {
  id: string;
  tenantId: string;
  fullName: string;
  email?: string;
  phone?: string;
  roles?: string[]; // ej: ["RESIDENT", "OWNER"]
};

// ============================================
// Form: Crear/Editar Unidad
// ============================================
export type CreateUnitInput = {
  buildingId: string; // required
  label: string; // required
  unitCode?: string; // optional
  unitType?: Unit['unitType'];
  occupancyStatus?: Unit['occupancyStatus'];
};

export type UpdateUnitInput = Partial<CreateUnitInput>;
