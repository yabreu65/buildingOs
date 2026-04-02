/**
 * Default ledger categories seeded when a new tenant is created.
 * 21 EXPENSE categories + 7 INCOME categories = 28 total
 * Three EXPENSE are optional (isActive: false): Gas, Seguridad, Ascensores.
 */

export interface DefaultLedgerCategory {
  code: string;              // Stable identifier for idempotence
  name: string;              // Display name (Spanish)
  description: string;       // User-visible description
  movementType: 'EXPENSE' | 'INCOME'; // Category type
  sortOrder: number;         // UI ordering (10, 20, 30, ...)
  isActive: boolean;         // false = optional/hidden by default
}

export const DEFAULT_LEDGER_CATEGORIES: DefaultLedgerCategory[] = [
  // ════════════════════════════════════════════════════════════════════════════
  // GASTOS (EXPENSE) — 21 categories
  // ════════════════════════════════════════════════════════════════════════════

  // ── Servicios (Utilities)
  {
    code: 'SERV_ELECTRICIDAD',
    name: 'Electricidad',
    description: 'Electricidad áreas comunes (escaleras, pasillos, ascensores)',
    movementType: 'EXPENSE',
    sortOrder: 10,
    isActive: true,
  },
  {
    code: 'SERV_AGUA',
    name: 'Agua',
    description: 'Agua áreas comunes y consumo general',
    movementType: 'EXPENSE',
    sortOrder: 20,
    isActive: true,
  },
  {
    code: 'SERV_GAS',
    name: 'Gas',
    description: 'Gas para calefacción o agua caliente',
    movementType: 'EXPENSE',
    sortOrder: 30,
    isActive: false, // Optional
  },
  {
    code: 'SERV_INTERNET',
    name: 'Internet / Telefonía',
    description: 'Servicio de internet y telefonía para áreas comunes',
    movementType: 'EXPENSE',
    sortOrder: 35,
    isActive: true,
  },

  // ── Limpieza y Mantenimiento
  {
    code: 'MANT_LIMPIEZA',
    name: 'Limpieza y Aseo',
    description: 'Personal de limpieza e insumos (escobas, detergentes, etc)',
    movementType: 'EXPENSE',
    sortOrder: 40,
    isActive: true,
  },
  {
    code: 'MANT_GENERAL',
    name: 'Mantenimiento General',
    description: 'Mantenimiento preventivo y correctivo del edificio',
    movementType: 'EXPENSE',
    sortOrder: 50,
    isActive: true,
  },
  {
    code: 'MANT_REPARACIONES',
    name: 'Reparaciones',
    description: 'Reparaciones de infraestructura y áreas comunes',
    movementType: 'EXPENSE',
    sortOrder: 60,
    isActive: true,
  },
  {
    code: 'MANT_PINTURA',
    name: 'Pintura y Acabados',
    description: 'Pintura de pasillos, común, fachada y trabajos similares',
    movementType: 'EXPENSE',
    sortOrder: 70,
    isActive: true,
  },

  // ── Personal y Seguridad
  {
    code: 'PERS_PORTERIA',
    name: 'Portería / Conserje',
    description: 'Honorarios de conserje/portero y beneficios',
    movementType: 'EXPENSE',
    sortOrder: 80,
    isActive: true,
  },
  {
    code: 'PERS_ADMINISTRADOR',
    name: 'Administrador / Gerente',
    description: 'Honorarios del administrador, gerente de edificio y beneficios',
    movementType: 'EXPENSE',
    sortOrder: 85,
    isActive: true,
  },
  {
    code: 'PERS_SEGURIDAD',
    name: 'Seguridad',
    description: 'Personal de seguridad 24/7 (si aplica)',
    movementType: 'EXPENSE',
    sortOrder: 90,
    isActive: false, // Optional
  },

  // ── Infraestructura y Equipos
  {
    code: 'INF_ASCENSORES',
    name: 'Mantenimiento de Ascensores',
    description: 'Mantenimiento preventivo y revisión periódica de ascensores',
    movementType: 'EXPENSE',
    sortOrder: 100,
    isActive: false, // Optional
  },
  {
    code: 'INF_BOMBAS_AGUA',
    name: 'Bomba de Agua',
    description: 'Mantenimiento de bombas, hidroneumático, tanques de agua',
    movementType: 'EXPENSE',
    sortOrder: 110,
    isActive: true,
  },
  {
    code: 'INF_PORTON_ACCESO',
    name: 'Portón / Accesos / Cerrajería',
    description: 'Mantenimiento de portones, puertas de emergencia, cerraduras',
    movementType: 'EXPENSE',
    sortOrder: 120,
    isActive: true,
  },
  {
    code: 'INF_INCENDIO',
    name: 'Sistema Contra Incendio',
    description: 'Mantenimiento y recarga de sistema de emergencia',
    movementType: 'EXPENSE',
    sortOrder: 130,
    isActive: true,
  },

  // ── Protección y Seguros
  {
    code: 'PROT_SEGURO_EDIF',
    name: 'Seguro del Edificio',
    description: 'Póliza de seguros de la estructura',
    movementType: 'EXPENSE',
    sortOrder: 140,
    isActive: true,
  },
  {
    code: 'PROT_RESP_CIVIL',
    name: 'Responsabilidad Civil',
    description: 'Póliza de responsabilidad civil del condominio',
    movementType: 'EXPENSE',
    sortOrder: 150,
    isActive: true,
  },

  // ── Administrativo y Finanzas
  {
    code: 'ADM_IMPUESTOS',
    name: 'Impuestos y Contribuciones',
    description: 'Impuestos municipales, contribuciones, tasas',
    movementType: 'EXPENSE',
    sortOrder: 160,
    isActive: true,
  },
  {
    code: 'ADM_BANCOS_COMIS',
    name: 'Comisiones Bancarias',
    description: 'Comisiones por servicios bancarios y transferencias',
    movementType: 'EXPENSE',
    sortOrder: 170,
    isActive: true,
  },
  {
    code: 'ADM_LEGAL_CONTAB',
    name: 'Legal / Contabilidad / Auditoría',
    description: 'Asesoría legal, contabilidad, honorarios de auditor',
    movementType: 'EXPENSE',
    sortOrder: 180,
    isActive: true,
  },

  // ── Fondo de Reserva
  {
    code: 'FONDO_RESERVA',
    name: 'Fondo de Reserva',
    description: 'Fondo para obras mayores y reparaciones extraordinarias',
    movementType: 'EXPENSE',
    sortOrder: 190,
    isActive: true,
  },

  // ════════════════════════════════════════════════════════════════════════════
  // INGRESOS (INCOME) — 7 categories
  // ════════════════════════════════════════════════════════════════════════════

  {
    code: 'ING_EXPENSAS_ORD',
    name: 'Expensas Ordinarias',
    description: 'Ingresos por expensas ordinarias (cuotas mensuales)',
    movementType: 'INCOME',
    sortOrder: 10,
    isActive: true,
  },
  {
    code: 'ING_EXPENSAS_EXT',
    name: 'Expensas Extraordinarias',
    description: 'Ingresos por expensas extraordinarias (mejoras, obras mayores)',
    movementType: 'INCOME',
    sortOrder: 20,
    isActive: true,
  },
  {
    code: 'ING_ALQUILER_COMUN',
    name: 'Alquiler de Espacios Comunes',
    description: 'Ingresos por alquiler de cocheras, balcones, depósitos',
    movementType: 'INCOME',
    sortOrder: 30,
    isActive: true,
  },
  {
    code: 'ING_INTERESES_MORA',
    name: 'Intereses por Mora',
    description: 'Ingresos por intereses por pago fuera de término',
    movementType: 'INCOME',
    sortOrder: 40,
    isActive: true,
  },
  {
    code: 'ING_MULTAS',
    name: 'Multas y Sanciones',
    description: 'Ingresos por multas a propietarios por incumplimiento',
    movementType: 'INCOME',
    sortOrder: 50,
    isActive: true,
  },
  {
    code: 'ING_SUBSIDIOS',
    name: 'Subsidios / Contribuciones Especiales',
    description: 'Ingresos por subsidios o contribuciones especiales de propietarios',
    movementType: 'INCOME',
    sortOrder: 60,
    isActive: true,
  },
  {
    code: 'ING_OTROS',
    name: 'Otros Ingresos',
    description: 'Otros ingresos no clasificados',
    movementType: 'INCOME',
    sortOrder: 70,
    isActive: true,
  },
];

// Alias para backward compatibility
export const DEFAULT_EXPENSE_CATEGORIES = DEFAULT_LEDGER_CATEGORIES.filter(
  (cat) => cat.movementType === 'EXPENSE',
);
