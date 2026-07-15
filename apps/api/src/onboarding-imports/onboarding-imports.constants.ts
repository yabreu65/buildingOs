export const ONBOARDING_IMPORTS_MAX_PREVIEW_ROWS = 25;
export const ONBOARDING_IMPORTS_S3_BUCKET = 'onboarding-imports';
export const ONBOARDING_IMPORTS_S3_PREFIX = 'imports';
export const ONBOARDING_IMPORTS_STORAGE_BASE_URL = '/api/onboarding-imports';
export const ONBOARDING_IMPORTS_ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const;

export const ONBOARDING_IMPORTS_ALLOWED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
]);
