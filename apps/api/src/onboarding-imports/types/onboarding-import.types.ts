import type { ImportJobStatus, ImportIssueSeverity, ImportType, Role } from '@prisma/client';

export interface ParsedRow<TRaw extends object, TNormalized extends object> {
  readonly sheet: ImportSheetName;
  readonly rowNumber: number;
  readonly raw: TRaw;
  readonly normalized: TNormalized | null;
}

export type ImportSheetName =
  | 'Instrucciones'
  | 'Edificios'
  | 'Unidades'
  | 'Personas'
  | 'Relaciones_Unidad'
  | 'Saldos_Iniciales';

export interface ParsedBuildingRowRaw {
  readonly codigo: unknown;
  readonly nombre: unknown;
  readonly direccion: unknown;
}

export interface ParsedBuildingRowNormalized {
  readonly codigo: string;
  readonly nombre: string;
  readonly direccion: string;
}

export interface ParsedUnitRowRaw {
  readonly edificio_codigo: unknown;
  readonly codigo: unknown;
  readonly etiqueta: unknown;
  readonly tipo: unknown;
  readonly m2: unknown;
  readonly facturacion: unknown;
  readonly estado_ocupacion: unknown;
  readonly categoria_nombre: unknown;
  readonly coeficiente: unknown;
}

export interface ParsedUnitRowNormalized {
  readonly edificioCodigo: string;
  readonly codigo: string;
  readonly etiqueta: string | null;
  readonly tipo: string;
  readonly m2: number | null;
  readonly facturacion: boolean;
  readonly estadoOcupacion: 'VACANT' | 'OCCUPIED' | null;
  readonly categoriaNombre: string | null;
  readonly coeficiente: number | null;
}

export interface ParsedPersonRowRaw {
  readonly persona_codigo: unknown;
  readonly nombre: unknown;
  readonly email: unknown;
  readonly telefono: unknown;
  readonly documento: unknown;
}

export interface ParsedPersonRowNormalized {
  readonly personaCodigo: string;
  readonly nombre: string;
  readonly email: string | null;
  readonly telefono: string | null;
  readonly documento: string | null;
}

export interface ParsedUnitRelationRowRaw {
  readonly persona_codigo: unknown;
  readonly edificio_codigo: unknown;
  readonly unidad_codigo: unknown;
  readonly rol: unknown;
  readonly principal: unknown;
  readonly fecha_inicio: unknown;
}

export interface ParsedUnitRelationRowNormalized {
  readonly personaCodigo: string;
  readonly edificioCodigo: string;
  readonly unidadCodigo: string;
  readonly rol: 'OWNER' | 'RESIDENT';
  readonly principal: boolean;
  readonly startDate: string;
}

export interface ParsedOpeningBalanceRowRaw {
  readonly edificio_codigo: unknown;
  readonly unidad_codigo: unknown;
  readonly periodo: unknown;
  readonly concepto: unknown;
  readonly monto: unknown;
  readonly moneda: unknown;
  readonly vencimiento: unknown;
  readonly tipo: unknown;
}

export interface ParsedOpeningBalanceRowNormalized {
  readonly edificioCodigo: string;
  readonly unidadCodigo: string;
  readonly period: string;
  readonly concept: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly dueDate: string;
  readonly kind: 'DEBITO' | 'CREDITO';
}

export interface ParsedWorkbookData {
  readonly buildings: Array<ParsedRow<ParsedBuildingRowRaw, ParsedBuildingRowNormalized>>;
  readonly units: Array<ParsedRow<ParsedUnitRowRaw, ParsedUnitRowNormalized>>;
  readonly people: Array<ParsedRow<ParsedPersonRowRaw, ParsedPersonRowNormalized>>;
  readonly relations: Array<ParsedRow<ParsedUnitRelationRowRaw, ParsedUnitRelationRowNormalized>>;
  readonly openingBalances: Array<ParsedRow<ParsedOpeningBalanceRowRaw, ParsedOpeningBalanceRowNormalized>>;
}

export interface WorkbookParseResult {
  readonly data: ParsedWorkbookData;
  readonly issues: ImportIssueRecord[];
}

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

export interface ImportIssueRecord {
  readonly sheet: ImportSheetName;
  readonly row: number | null;
  readonly column: string | null;
  readonly code: string;
  readonly severity: ImportIssueSeverity;
  readonly message: string;
  readonly receivedValue: string | null;
  readonly normalizedValue: string | null;
}

export interface ImportAccessContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly membershipId: string | null;
  readonly roles: Role[];
  readonly isSuperAdmin: boolean;
}

export interface StoredImportObjectKeys {
  readonly originalObjectKey: string;
  readonly normalizedObjectKey: string;
}

export interface UploadableSpreadsheetFile {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

export interface ImportJobPayload {
  readonly type: ImportType;
  readonly status: ImportJobStatus;
  readonly schemaVersion: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly fileMimeType: string;
  readonly fileHash: string;
  readonly originalObjectKey: string;
  readonly normalizedObjectKey: string;
  readonly summary: ImportPreviewSummary;
  readonly counts: ImportPreviewSummary;
  readonly canConfirm: boolean;
  readonly expiresAt: Date;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
  readonly createdByMembershipId?: string | null;
}

export interface ImportJobView {
  readonly importId: string;
  readonly tenantId: string;
  readonly type: ImportType;
  readonly fileName: string;
  readonly fileHash: string;
  readonly schemaVersion: string;
  readonly previewVersion: number;
  readonly status: ImportJobStatus | 'EXPIRED';
  readonly expiresAt: string;
  readonly canConfirm: boolean;
  readonly summary: ImportPreviewSummary;
  readonly counts: ImportPreviewSummary;
  readonly issueCount: number;
  readonly blockingIssueCount: number;
  readonly warningCount: number;
  readonly confirmedAt: string | null;
  readonly confirmedByMembershipId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ConfirmOnboardingImportRequest {
  readonly expectedPreviewVersion?: number;
  readonly confirmationToken?: string;
}

export interface ConfirmOnboardingImportSummary {
  readonly buildingsCreated: number;
  readonly buildingsReused: number;
  readonly unitCategoriesCreated: number;
  readonly unitCategoriesReused: number;
  readonly unitsCreated: number;
  readonly unitsReused: number;
  readonly peopleCreated: number;
  readonly peopleReused: number;
  readonly relationsCreated: number;
  readonly relationsReused: number;
  readonly chargesCreated: number;
  readonly chargesReused: number;
}

export interface ConfirmOnboardingImportResult {
  readonly importId: string;
  readonly status: 'CONFIRMED';
  readonly confirmedAt: string;
  readonly summary: ConfirmOnboardingImportSummary;
}

export interface ImportIssuePageItem {
  readonly id: string;
  readonly sheet: ImportSheetName;
  readonly row: number | null;
  readonly column: string | null;
  readonly code: string;
  readonly severity: ImportIssueSeverity;
  readonly message: string;
  readonly receivedValue: string | null;
  readonly normalizedValue: string | null;
  readonly createdAt: string;
}

export interface ImportIssuePageResponse {
  readonly data: ImportIssuePageItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}
