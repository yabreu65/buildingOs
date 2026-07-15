import { ImportType } from '@prisma/client';

export const ONBOARDING_IMPORT_SCHEMA_VERSION = 'v1';
export const ONBOARDING_IMPORT_TYPE = ImportType.INITIAL_ONBOARDING;
export const ONBOARDING_IMPORT_TEMPLATE_FILENAME = 'buildingos-importacion-inicial-v1.xlsx';
export const ONBOARDING_IMPORT_TEMPLATE_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const ONBOARDING_IMPORT_OBJECT_KEY_PREFIX = 'tenant-imports';
export const ONBOARDING_IMPORT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const ONBOARDING_IMPORT_MAX_ZIP_ENTRIES = 200;
export const ONBOARDING_IMPORT_MAX_ZIP_RATIO = 120;
export const ONBOARDING_IMPORT_MAX_ZIP_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
export const ONBOARDING_IMPORT_MAX_SHEETS = 10;
export const ONBOARDING_IMPORT_MAX_ROWS_PER_SHEET = 5000;
export const ONBOARDING_IMPORT_MAX_COLUMNS_PER_SHEET = 40;
export const ONBOARDING_IMPORT_MAX_CELL_TEXT_LENGTH = 5000;
export const ONBOARDING_IMPORT_ISSUE_PAGE_SIZE_MAX = 100;
export const ONBOARDING_IMPORT_EXPIRES_DAYS = 30;
export const ONBOARDING_IMPORT_CONFIRM_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

export const ONBOARDING_IMPORT_ALLOWED_MIME_TYPES = new Set<string>([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/octet-stream',
]);

export const ONBOARDING_IMPORT_REQUIRED_SHEETS = [
  'Instrucciones',
  'Edificios',
  'Unidades',
  'Personas',
  'Relaciones_Unidad',
  'Saldos_Iniciales',
] as const;

export const ONBOARDING_IMPORT_SHEETS = {
  instructions: 'Instrucciones',
  buildings: 'Edificios',
  units: 'Unidades',
  people: 'Personas',
  relations: 'Relaciones_Unidad',
  openingBalances: 'Saldos_Iniciales',
} as const;

export const ONBOARDING_IMPORT_ALLOWED_ROLES = [
  'TENANT_OWNER',
  'TENANT_ADMIN',
  'OPERATOR',
  'SUPER_ADMIN',
] as const;

export const ONBOARDING_IMPORT_ALLOWED_BOOLEAN_VALUES = new Map<string, boolean>([
  ['SI', true],
  ['SÍ', true],
  ['NO', false],
]);

export const ONBOARDING_IMPORT_ALLOWED_CURRENCIES = ['ARS', 'VES', 'USD'] as const;
export const ONBOARDING_IMPORT_ALLOWED_UNIT_TYPES = [
  'APARTAMENTO',
  'CASA',
  'OFICINA',
  'DEPOSITO',
  'ESTACIONAMIENTO',
] as const;
