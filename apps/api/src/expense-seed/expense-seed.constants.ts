/**
 * Default expense ledger categories seeded when a new tenant is created.
 * These 19 categories cover typical condominium expenses.
 * Three are optional (active: false): Gas, Seguridad, Ascensores.
 */

export interface DefaultExpenseCategory {
  code: string;          // Stable identifier for idempotence
  name: string;          // Display name (Spanish)
  description: string;   // User-visible description
  sortOrder: number;     // UI ordering (10, 20, 30, ...)
  active: boolean;       // false = optional/hidden by default
}

export const DEFAULT_EXPENSE_CATEGORIES: DefaultExpenseCategory[] = [
  // ── Servicios (Utilities)
  {
    code: 'SERV_ELECTRICIDAD',
    name: 'Electricidad',
    description: 'Electricidad áreas comunes (escaleras, pasillos, ascensores)',
    sortOrder: 10,
    active: true,
  },
  {
    code: 'SERV_AGUA',
    name: 'Agua',
    description: 'Agua áreas comunes y consumo general',
    sortOrder: 20,
    active: true,
  },
  {
    code: 'SERV_GAS',
    name: 'Gas',
    description: 'Gas para calefacción o agua caliente',
    sortOrder: 30,
    active: false, // Optional
  },

  // ── Limpieza y Mantenimiento
  {
    code: 'MANT_LIMPIEZA',
    name: 'Limpieza y Aseo',
    description: 'Personal de limpieza e insumos (escobas, detergentes, etc)',
    sortOrder: 40,
    active: true,
  },
  {
    code: 'MANT_GENERAL',
    name: 'Mantenimiento General',
    description: 'Mantenimiento preventivo y correctivo del edificio',
    sortOrder: 50,
    active: true,
  },
  {
    code: 'MANT_REPARACIONES',
    name: 'Reparaciones',
    description: 'Reparaciones de infraestructura y áreas comunes',
    sortOrder: 60,
    active: true,
  },
  {
    code: 'MANT_PINTURA',
    name: 'Pintura y Acabados',
    description: 'Pintura de pasillos, común, fachada y trabajos similares',
    sortOrder: 70,
    active: true,
  },

  // ── Personal y Seguridad
  {
    code: 'PERS_PORTERIA',
    name: 'Portería / Conserje',
    description: 'Honorarios de conserje/portero y beneficios',
    sortOrder: 80,
    active: true,
  },
  {
    code: 'PERS_SEGURIDAD',
    name: 'Seguridad',
    description: 'Personal de seguridad 24/7 (si aplica)',
    sortOrder: 90,
    active: false, // Optional
  },

  // ── Infraestructura y Equipos
  {
    code: 'INF_ASCENSORES',
    name: 'Mantenimiento de Ascensores',
    description: 'Mantenimiento preventivo y revisión periódica de ascensores',
    sortOrder: 100,
    active: false, // Optional
  },
  {
    code: 'INF_BOMBAS_AGUA',
    name: 'Bomba de Agua',
    description: 'Mantenimiento de bombas, hidroneumático, tanques de agua',
    sortOrder: 110,
    active: true,
  },
  {
    code: 'INF_PORTON_ACCESO',
    name: 'Portón / Accesos / Cerrajería',
    description: 'Mantenimiento de portones, puertas de emergencia, cerraduras',
    sortOrder: 120,
    active: true,
  },
  {
    code: 'INF_INCENDIO',
    name: 'Sistema Contra Incendio',
    description: 'Mantenimiento y recarga de sistema de emergencia',
    sortOrder: 130,
    active: true,
  },

  // ── Protección y Seguros
  {
    code: 'PROT_SEGURO_EDIF',
    name: 'Seguro del Edificio',
    description: 'Póliza de seguros de la estructura',
    sortOrder: 140,
    active: true,
  },
  {
    code: 'PROT_RESP_CIVIL',
    name: 'Responsabilidad Civil',
    description: 'Póliza de responsabilidad civil del condominio',
    sortOrder: 150,
    active: true,
  },

  // ── Administrativo y Finanzas
  {
    code: 'ADM_IMPUESTOS',
    name: 'Impuestos y Contribuciones',
    description: 'Impuestos municipales, contribuciones, tasas',
    sortOrder: 160,
    active: true,
  },
  {
    code: 'ADM_BANCOS_COMIS',
    name: 'Comisiones Bancarias',
    description: 'Comisiones por servicios bancarios y transferencias',
    sortOrder: 170,
    active: true,
  },
  {
    code: 'ADM_LEGAL_CONTAB',
    name: 'Legal / Contabilidad / Auditoría',
    description: 'Asesoría legal, contabilidad, honorarios de auditor',
    sortOrder: 180,
    active: true,
  },

  // ── Fondo de Reserva
  {
    code: 'FONDO_RESERVA',
    name: 'Fondo de Reserva',
    description: 'Fondo para obras mayores y reparaciones extraordinarias',
    sortOrder: 190,
    active: true,
  },
];
