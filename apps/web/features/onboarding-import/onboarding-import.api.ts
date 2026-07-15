import { apiClient } from '@/shared/lib/http/client';

export type OnboardingImportStatus =
  | 'READY'
  | 'BLOCKED'
  | 'FAILED'
  | 'EXPIRED'
  | 'CONFIRMING'
  | 'CONFIRMED';

export type ImportIssueSeverity = 'BLOCKER' | 'WARNING' | 'INFO';

export interface ImportSheetStats {
  total: number;
  new: number;
  reusable: number;
  conflict: number;
  invalid: number;
}

export interface ImportPreviewSummary {
  buildings: ImportSheetStats;
  units: ImportSheetStats;
  people: ImportSheetStats;
  relations: ImportSheetStats;
  openingBalances: ImportSheetStats;
  blockingIssues: number;
  warnings: number;
}

export interface OnboardingImportJob {
  importId: string;
  tenantId: string;
  type: 'INITIAL_ONBOARDING';
  fileName: string;
  fileHash: string;
  schemaVersion: string;
  previewVersion: number;
  status: OnboardingImportStatus | 'EXPIRED';
  expiresAt: string;
  canConfirm: boolean;
  summary: ImportPreviewSummary;
  counts: ImportPreviewSummary;
  issueCount: number;
  blockingIssueCount: number;
  warningCount: number;
  confirmedAt: string | null;
  confirmedByMembershipId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingImportIssue {
  id: string;
  sheet: string;
  row: number | null;
  column: string | null;
  code: string;
  severity: ImportIssueSeverity;
  message: string;
  receivedValue: string | null;
  normalizedValue: string | null;
  createdAt: string;
}

export interface OnboardingImportIssuePage {
  data: OnboardingImportIssue[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ConfirmOnboardingImportRequest {
  expectedPreviewVersion?: number;
  confirmationToken?: string;
}

export interface ConfirmOnboardingImportResult {
  importId: string;
  status: 'CONFIRMED';
  confirmedAt: string;
  summary: {
    buildingsCreated: number;
    buildingsReused: number;
    unitCategoriesCreated: number;
    unitCategoriesReused: number;
    unitsCreated: number;
    unitsReused: number;
    peopleCreated: number;
    peopleReused: number;
    relationsCreated: number;
    relationsReused: number;
    chargesCreated: number;
    chargesReused: number;
  };
}

export interface ImportIssueFilters {
  severity?: ImportIssueSeverity | '';
  sheet?: string;
  code?: string;
  page?: number;
  pageSize?: number;
}

export const ONBOARDING_IMPORT_TEMPLATE_FILENAME = 'buildingos-importacion-inicial-v1.xlsx';
export const ONBOARDING_IMPORT_ALLOWED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/octet-stream',
];

function buildTenantPath(tenantId: string, suffix: string): string {
  return `/tenants/${tenantId}/onboarding-imports${suffix}`;
}

function buildIssueQuery(filters: ImportIssueFilters): string {
  const params = new URLSearchParams();

  if (filters.severity) {
    params.set('severity', filters.severity);
  }
  if (filters.sheet) {
    params.set('sheet', filters.sheet);
  }
  if (filters.code) {
    params.set('code', filters.code);
  }
  if (filters.page) {
    params.set('page', String(filters.page));
  }
  if (filters.pageSize) {
    params.set('pageSize', String(filters.pageSize));
  }

  const query = params.toString();
  return query ? `?${query}` : '';
}

export async function downloadOnboardingImportTemplate(tenantId: string): Promise<{
  fileName: string;
  blob: Blob;
}> {
  const blob = await apiClient<Blob>({
    path: buildTenantPath(tenantId, '/template'),
    method: 'GET',
    responseType: 'blob',
  });

  return {
    fileName: ONBOARDING_IMPORT_TEMPLATE_FILENAME,
    blob,
  };
}

export async function previewOnboardingImport(
  tenantId: string,
  file: File,
): Promise<OnboardingImportJob> {
  const formData = new FormData();
  formData.append('file', file);

  return apiClient<OnboardingImportJob, FormData>({
    path: buildTenantPath(tenantId, '/preview'),
    method: 'POST',
    body: formData,
  });
}

export async function getOnboardingImport(
  tenantId: string,
  importId: string,
): Promise<OnboardingImportJob> {
  return apiClient<OnboardingImportJob>({
    path: buildTenantPath(tenantId, `/${importId}`),
    method: 'GET',
  });
}

export async function listOnboardingImportIssues(
  tenantId: string,
  importId: string,
  filters: ImportIssueFilters = {},
): Promise<OnboardingImportIssuePage> {
  return apiClient<OnboardingImportIssuePage>({
    path: `${buildTenantPath(tenantId, `/${importId}/issues`)}${buildIssueQuery(filters)}`,
    method: 'GET',
  });
}

export async function confirmOnboardingImport(
  tenantId: string,
  importId: string,
  body: ConfirmOnboardingImportRequest = {},
): Promise<ConfirmOnboardingImportResult> {
  return apiClient<ConfirmOnboardingImportResult, ConfirmOnboardingImportRequest>({
    path: buildTenantPath(tenantId, `/${importId}/confirm`),
    method: 'POST',
    body,
  });
}
