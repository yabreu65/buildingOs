import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  AuditAction,
  ImportJobStatus,
  ImportIssueSeverity,
  ImportType,
  Prisma,
  Role,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../storage/minio.service';
import { ONBOARDING_IMPORT_ALLOWED_MIME_TYPES, ONBOARDING_IMPORT_EXPIRES_DAYS, ONBOARDING_IMPORT_ISSUE_PAGE_SIZE_MAX, ONBOARDING_IMPORT_MAX_FILE_SIZE_BYTES, ONBOARDING_IMPORT_OBJECT_KEY_PREFIX, ONBOARDING_IMPORT_PREVIEW_VERSION, ONBOARDING_IMPORT_SCHEMA_VERSION, ONBOARDING_IMPORT_TYPE } from './onboarding-imports.constants';
import { OnboardingImportConfirmationService } from './services/onboarding-import-confirmation.service';
import { OnboardingImportNormalizerService } from './services/onboarding-import-normalizer.service';
import { OnboardingImportParserService } from './services/onboarding-import-parser.service';
import { OnboardingImportTemplateService } from './services/onboarding-import-template.service';
import type {
  ImportAccessContext,
  ImportIssuePageResponse,
  ImportIssueRecord,
  ImportJobView,
  ImportPreviewSummary,
  ConfirmOnboardingImportRequest,
  ConfirmOnboardingImportResult,
  ImportSheetStats,
  ImportSheetName,
  ParsedBuildingRowNormalized,
  ParsedBuildingRowRaw,
  ParsedPersonRowNormalized,
  ParsedPersonRowRaw,
  ParsedRow,
  ParsedUnitRowNormalized,
  ParsedUnitRowRaw,
  ParsedWorkbookData,
  UploadableSpreadsheetFile,
  StoredImportObjectKeys,
} from './types/onboarding-import.types';
import type { AuthenticatedUser } from '../common/types/request.types';

interface ResolvedImportAccessContext extends ImportAccessContext {
  readonly tenantCurrency: string;
}

interface ExistingBuildingRecord {
  readonly id: string;
  readonly alias: string;
  readonly name: string;
  readonly address: string | null;
  readonly deletedAt: Date | null;
}

interface ExistingUnitRecord {
  readonly id: string;
  readonly buildingId: string;
  readonly code: string;
  readonly label: string | null;
  readonly unitType: string;
  readonly m2: number | null;
  readonly isBillable: boolean;
  readonly occupancyStatus: string | null;
}

interface ExistingCategoryRecord {
  readonly id: string;
  readonly buildingId: string;
  readonly name: string;
  readonly coefficient: number;
}

interface ExistingUserRecord {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
}

interface ExistingTenantMemberRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly role: Role;
  readonly status: string;
}

interface ExistingReferenceRecord {
  readonly entityType: string;
  readonly externalCode: string;
  readonly entityId: string;
}

interface ExistingOccupantRecord {
  readonly unitId: string;
  readonly memberId: string;
  readonly role: string;
  readonly isPrimary: boolean;
  readonly startDate: Date;
  readonly endDate: Date | null;
}

interface ExistingChargeRecord {
  readonly buildingId: string;
  readonly unitId: string;
  readonly period: string;
  readonly concept: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: string;
}

interface JobCreatePayload {
  readonly importId: string;
  readonly tenantId: string;
  readonly previewVersion: number;
  readonly previewHash: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly fileHash: string;
  readonly fileMimeType: string;
  readonly originalObjectKey: string;
  readonly normalizedObjectKey: string | null;
  readonly summary: ImportPreviewSummary;
  readonly issues: ImportIssueRecord[];
  readonly canConfirm: boolean;
  readonly status: ImportJobStatus;
}

interface ValidationResult {
  readonly summary: ImportPreviewSummary;
  readonly issues: ImportIssueRecord[];
}

@Injectable()
export class OnboardingImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly auditService: AuditService,
    private readonly confirmationService: OnboardingImportConfirmationService,
    private readonly templateService: OnboardingImportTemplateService,
    private readonly parserService: OnboardingImportParserService,
    private readonly normalizer: OnboardingImportNormalizerService,
  ) {}

  async confirmImport(
    input: { tenantId: string; user: AuthenticatedUser; importId: string },
    request: ConfirmOnboardingImportRequest,
  ): Promise<ConfirmOnboardingImportResult> {
    const access = await this.resolveAccessContext(input.user, input.tenantId);

    return this.confirmationService.confirmImport({
      tenantId: access.tenantId,
      tenantCurrency: access.tenantCurrency,
      userId: access.userId,
      membershipId: access.membershipId,
      roles: access.roles,
      isSuperAdmin: access.isSuperAdmin,
      importId: input.importId,
      expectedPreviewVersion: request.expectedPreviewVersion,
      confirmationToken: request.confirmationToken,
    });
  }

  async getTemplate(input: { tenantId: string; user: AuthenticatedUser }): Promise<{ fileName: string; contentType: string; buffer: Buffer }> {
    const access = await this.resolveAccessContext(input.user, input.tenantId);
    const buffer = this.templateService.createTemplateBuffer();

    void this.auditService.createLog({
      tenantId: input.tenantId,
      actorUserId: input.user.id,
      actorMembershipId: access.membershipId ?? undefined,
      action: AuditAction.IMPORT_FILE_LOADED,
      entityType: 'ImportJob',
      entityId: 'template',
      metadata: {
        schemaVersion: ONBOARDING_IMPORT_SCHEMA_VERSION,
        fileSize: buffer.length,
      },
    });

    return {
      fileName: this.templateService.getTemplateFileName(),
      contentType: this.templateService.getTemplateContentType(),
      buffer,
    };
  }

  async previewImport(
    input: { tenantId: string; user: AuthenticatedUser },
    file: UploadableSpreadsheetFile | undefined,
  ): Promise<ImportJobView> {
    const access = await this.resolveAccessContext(input.user, input.tenantId);
    const uploadedFile = this.assertFile(file);
    const fileName = this.normalizer.sanitizeFileName(uploadedFile.originalname);
    const fileHash = this.computeHash(uploadedFile.buffer);

    const existing = await this.findExistingJob(input.tenantId, fileHash);
    if (existing) {
      const reusedAction =
        existing.status === ImportJobStatus.BLOCKED
          ? AuditAction.IMPORT_PREVIEW_BLOCKED
          : existing.status === ImportJobStatus.FAILED
            ? AuditAction.IMPORT_PREVIEW_FAILED
            : AuditAction.IMPORT_PREVIEW_READY;

      void this.auditService.createLog({
        tenantId: input.tenantId,
        actorUserId: input.user.id,
        actorMembershipId: access.membershipId ?? undefined,
        action: reusedAction,
        entityType: 'ImportJob',
        entityId: existing.importId,
        metadata: {
          fileHash,
          schemaVersion: existing.schemaVersion,
          reused: true,
        },
      });

      return existing;
    }

    const importId = randomUUID();
    const keys = this.buildObjectKeys(input.tenantId, importId);
    let normalizedUploaded = false;

    await this.uploadOriginalFile(keys.originalObjectKey, uploadedFile.buffer, uploadedFile.mimetype);

    try {
      const parsed = this.parserService.parseWorkbook(uploadedFile.buffer);
      const validation = await this.validateWorkbook(input.tenantId, access.tenantCurrency, parsed.data, parsed.issues);
      const status = validation.summary.blockingIssues > 0 ? ImportJobStatus.BLOCKED : ImportJobStatus.READY;
      const normalizedObjectKey = status === ImportJobStatus.READY ? keys.normalizedObjectKey : null;
      const previewVersion = ONBOARDING_IMPORT_PREVIEW_VERSION;
      const previewHash = this.computeHash(Buffer.from(JSON.stringify(this.buildNormalizedPayload(input.tenantId, importId, fileHash, fileName, validation, parsed.data)), 'utf8'));

      if (normalizedObjectKey) {
        const normalizedPayload = this.buildNormalizedPayload(input.tenantId, importId, fileHash, fileName, validation, parsed.data);
        await this.minio.uploadBuffer(undefined, normalizedObjectKey, Buffer.from(JSON.stringify(normalizedPayload), 'utf8'), 'application/json');
        normalizedUploaded = true;
      }

      const created = await this.persistJob({
        importId,
        tenantId: input.tenantId,
        previewVersion,
        previewHash,
        fileName,
        fileSize: uploadedFile.size,
        fileHash,
        fileMimeType: uploadedFile.mimetype,
        originalObjectKey: keys.originalObjectKey,
        normalizedObjectKey,
        summary: validation.summary,
        issues: validation.issues,
        canConfirm: status === ImportJobStatus.READY,
        status,
      });

      void this.auditService.createLog({
        tenantId: input.tenantId,
        actorUserId: input.user.id,
        actorMembershipId: access.membershipId ?? undefined,
        action: status === ImportJobStatus.BLOCKED ? AuditAction.IMPORT_PREVIEW_BLOCKED : AuditAction.IMPORT_PREVIEW_READY,
        entityType: 'ImportJob',
        entityId: created.importId,
        metadata: {
          fileHash,
          fileSize: uploadedFile.size,
          schemaVersion: ONBOARDING_IMPORT_SCHEMA_VERSION,
          issueCount: validation.issues.length,
          blockingIssueCount: validation.summary.blockingIssues,
        },
      });

      return created;
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        await this.cleanupImportObjects(keys);
        const existingAfterConflict = await this.findExistingJob(input.tenantId, fileHash);
        if (existingAfterConflict) {
          const reusedAction =
            existingAfterConflict.status === ImportJobStatus.BLOCKED
              ? AuditAction.IMPORT_PREVIEW_BLOCKED
              : existingAfterConflict.status === ImportJobStatus.FAILED
                ? AuditAction.IMPORT_PREVIEW_FAILED
                : AuditAction.IMPORT_PREVIEW_READY;

          void this.auditService.createLog({
            tenantId: input.tenantId,
            actorUserId: input.user.id,
            actorMembershipId: access.membershipId ?? undefined,
            action: reusedAction,
            entityType: 'ImportJob',
            entityId: existingAfterConflict.importId,
            metadata: {
              fileHash,
              schemaVersion: existingAfterConflict.schemaVersion,
              reused: true,
              conflictRecovered: true,
            },
          });

          return existingAfterConflict;
        }
      }

      if (normalizedUploaded) {
        await this.minio.deleteObject(undefined, keys.normalizedObjectKey);
      }

      await this.persistFailedImport({
        tenantId: input.tenantId,
        membershipId: access.membershipId ?? null,
        importId,
        fileName,
        fileSize: uploadedFile.size,
        fileHash,
        fileMimeType: uploadedFile.mimetype,
        originalObjectKey: keys.originalObjectKey,
        error,
      });

      void this.auditService.createLog({
        tenantId: input.tenantId,
        actorUserId: input.user.id,
        actorMembershipId: access.membershipId ?? undefined,
        action: AuditAction.IMPORT_PREVIEW_FAILED,
        entityType: 'ImportJob',
        entityId: importId,
        metadata: {
          fileHash,
          fileSize: uploadedFile.size,
          schemaVersion: ONBOARDING_IMPORT_SCHEMA_VERSION,
          errorCode: this.sanitizeErrorCode(error),
        },
      });

      throw this.rethrow(error);
    }
  }

  async getImport(input: { tenantId: string; user: AuthenticatedUser; importId: string }): Promise<ImportJobView> {
    await this.resolveAccessContext(input.user, input.tenantId);

    const job = await this.prisma.importJob.findFirst({
      where: {
        id: input.importId,
        tenantId: input.tenantId,
      },
      include: {
        issues: {
          select: { id: true },
        },
      },
    });

    if (!job) {
      throw new NotFoundException('Importación no encontrada');
    }

    return this.mapJobView(job);
  }

  async listIssues(
    input: { tenantId: string; user: AuthenticatedUser; importId: string },
    filters: { severity?: ImportIssueSeverity; sheet?: string; code?: string; page: number; pageSize: number },
  ): Promise<ImportIssuePageResponse> {
    await this.resolveAccessContext(input.user, input.tenantId);

    const pageSize = Math.min(Math.max(filters.pageSize, 1), ONBOARDING_IMPORT_ISSUE_PAGE_SIZE_MAX);
    const page = Math.max(filters.page, 1);
    const skip = (page - 1) * pageSize;

    const where: Prisma.ImportIssueWhereInput = {
      tenantId: input.tenantId,
      importJobId: input.importId,
    };

    if (filters.severity) {
      where.severity = filters.severity;
    }
    if (filters.sheet) {
      where.sheet = filters.sheet;
    }
    if (filters.code) {
      where.code = filters.code;
    }

    const [data, total] = await Promise.all([
      this.prisma.importIssue.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.importIssue.count({ where }),
    ]);

    return {
      data: data.map((issue) => ({
        id: issue.id,
        sheet: issue.sheet as ImportSheetName,
        row: issue.row,
        column: issue.column,
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        receivedValue: issue.receivedValue,
        normalizedValue: issue.normalizedValue,
        createdAt: issue.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  private async resolveAccessContext(user: AuthenticatedUser, tenantId: string): Promise<ResolvedImportAccessContext> {
    if (!tenantId.trim()) {
      throw new BadRequestException('tenantId es requerido');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, currency: true },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant no encontrado');
    }

    const memberships = user.memberships ?? [];
    const superAdminMembership = memberships.find((membership) => membership.roles.includes('SUPER_ADMIN'));
    const isSuperAdmin = user.isSuperAdmin === true || Boolean(superAdminMembership);

    if (isSuperAdmin) {
      return {
        tenantId,
        tenantCurrency: tenant.currency,
        userId: user.id,
        membershipId: superAdminMembership?.id ?? user.membershipId ?? null,
        roles: user.roles ?? superAdminMembership?.roles ?? [],
        isSuperAdmin: true,
      };
    }

    const membership = memberships.find((entry) => entry.tenantId === tenantId);
    if (!membership) {
      throw new ForbiddenException('No tiene acceso al tenant solicitado');
    }

    const roles = membership.roles ?? [];
    const isResidentOnly = roles.length > 0 && roles.every((role) => role === 'RESIDENT');
    if (roles.length === 0 || isResidentOnly) {
      throw new ForbiddenException('RESIDENT no puede acceder a importaciones administrativas');
    }

    const allowedRoles: Role[] = ['TENANT_OWNER', 'TENANT_ADMIN', 'OPERATOR'];
    if (!roles.some((role) => allowedRoles.includes(role))) {
      throw new ForbiddenException('No tiene permisos para importar datos');
    }

    return {
      tenantId,
      tenantCurrency: tenant.currency,
      userId: user.id,
      membershipId: membership.id ?? null,
      roles,
      isSuperAdmin: false,
    };
  }

  private async validateWorkbook(
    tenantId: string,
    tenantCurrency: string,
    data: ParsedWorkbookData,
    parseIssues: ImportIssueRecord[],
  ): Promise<ValidationResult> {
    const summary = this.createEmptySummary();
    const issues = [...parseIssues];

    const existingBuildings = await this.prisma.building.findMany({
      where: { tenantId },
      select: { id: true, alias: true, name: true, address: true, deletedAt: true },
    });
    const buildingByCode = new Map(existingBuildings.map((building) => [this.normalizeCode(building.alias), building] as const));
    const buildingIdByCode = new Map(existingBuildings.map((building) => [this.normalizeCode(building.alias), building.id] as const));

    const buildingRowsByCode = new Map<string, ParsedRow<ParsedBuildingRowRaw, ParsedBuildingRowNormalized>>();
    const availableBuildingCodes = new Set<string>();
    for (const row of data.buildings) {
      const normalized = row.normalized;
      if (!normalized) {
        this.bump(summary.buildings, 'invalid');
        continue;
      }

      const code = this.normalizeCode(normalized.codigo);
      if (buildingRowsByCode.has(code)) {
        this.bump(summary.buildings, 'conflict');
        issues.push(this.makeIssue(row.sheet, row.rowNumber, 'codigo', 'DUPLICATE_IN_FILE', 'BLOCKER', `Duplicate building code in file: ${code}`, code, code));
        continue;
      }

      buildingRowsByCode.set(code, row);

      const existing = buildingByCode.get(code);
      if (!existing) {
        this.bump(summary.buildings, 'new');
        availableBuildingCodes.add(code);
        continue;
      }

      if (existing.deletedAt) {
        this.bump(summary.buildings, 'conflict');
        issues.push(this.makeIssue(row.sheet, row.rowNumber, 'codigo', 'DELETED_BUILDING', 'BLOCKER', `Building ${code} was deleted`, code, code));
        continue;
      }

      const sameName = this.normalizeText(existing.name) === this.normalizeText(normalized.nombre);
    const sameAddress = this.normalizeText(existing.address ?? '') === this.normalizeText(normalized.direccion);
      if (sameName && sameAddress) {
        this.bump(summary.buildings, 'reusable');
        availableBuildingCodes.add(code);
      } else {
        this.bump(summary.buildings, 'conflict');
        issues.push(this.makeIssue(row.sheet, row.rowNumber, 'codigo', 'CONFLICT_WITH_DB', 'BLOCKER', `Building ${code} conflicts with an existing record`, code, code));
      }
    }

    const existingCategories = await this.prisma.unitCategory.findMany({
      where: {
        tenantId,
        buildingId: { in: existingBuildings.map((building) => building.id) },
      },
      select: { id: true, buildingId: true, name: true, coefficient: true },
    });
    const categoriesByBuildingAndName = new Map(existingCategories.map((category) => [`${category.buildingId}:${this.normalizeText(category.name ?? '')}`, category] as const));

    const existingUnits = await this.prisma.unit.findMany({
      where: {
        tenantId,
        buildingId: { in: existingBuildings.map((building) => building.id) },
      },
      select: {
        id: true,
        buildingId: true,
        code: true,
        label: true,
        unitType: true,
        m2: true,
        isBillable: true,
        occupancyStatus: true,
      },
    });
    const unitByBuildingAndCode = new Map(existingUnits.map((unit) => [`${unit.buildingId}:${this.normalizeCode(unit.code)}`, unit] as const));
    const unitIdByBuildingAndCode = new Map(existingUnits.map((unit) => [`${unit.buildingId}:${this.normalizeCode(unit.code)}`, unit.id] as const));

    const unitRowsByKey = new Map<string, ParsedRow<ParsedUnitRowRaw, ParsedUnitRowNormalized>>();
    const unitStatusByKey = new Map<string, 'new' | 'reusable' | 'conflict' | 'invalid'>();
    for (const row of data.units) {
      const normalized = row.normalized;
      if (!normalized) {
        this.bump(summary.units, 'invalid');
        continue;
      }

      const buildingCode = this.normalizeCode(normalized.edificioCodigo);
      const unitCode = this.normalizeCode(normalized.codigo);
      const rowKey = `${buildingCode}:${unitCode}`;
      const buildingId = buildingIdByCode.get(buildingCode);
      const buildingKnown = availableBuildingCodes.has(buildingCode);

      if (!buildingKnown) {
        this.bump(summary.units, 'invalid');
        unitStatusByKey.set(rowKey, 'invalid');
        issues.push(this.makeIssue(row.sheet, row.rowNumber, 'edificio_codigo', 'UNKNOWN_BUILDING', 'BLOCKER', `Building ${buildingCode} does not exist in file or database`, buildingCode, null));
        continue;
      }

      if (unitRowsByKey.has(rowKey)) {
        this.bump(summary.units, 'conflict');
        unitStatusByKey.set(rowKey, 'conflict');
        issues.push(this.makeIssue(row.sheet, row.rowNumber, 'codigo', 'DUPLICATE_IN_FILE', 'BLOCKER', `Duplicate unit code within building ${buildingCode}`, unitCode, rowKey));
        continue;
      }

      unitRowsByKey.set(rowKey, row);

      const existingUnit = buildingId ? unitByBuildingAndCode.get(`${buildingId}:${unitCode}`) : undefined;
      if (existingUnit) {
        const expectedOccupancyStatus = normalized.estadoOcupacion ?? (normalized.facturacion ? 'OCCUPIED' : 'VACANT');
        const sameUnit =
          this.normalizeText(existingUnit.label ?? '') === this.normalizeText(normalized.etiqueta ?? '') &&
          this.normalizeText(existingUnit.unitType) === this.normalizeText(normalized.tipo) &&
          this.compareNullableNumber(existingUnit.m2, normalized.m2) &&
          existingUnit.isBillable === normalized.facturacion &&
          this.normalizeText(existingUnit.occupancyStatus ?? '') === expectedOccupancyStatus;

        if (sameUnit) {
          this.bump(summary.units, 'reusable');
          unitStatusByKey.set(rowKey, 'reusable');
        } else {
          this.bump(summary.units, 'conflict');
          unitStatusByKey.set(rowKey, 'conflict');
          issues.push(this.makeIssue(row.sheet, row.rowNumber, 'codigo', 'CONFLICT_WITH_DB', 'BLOCKER', `Unit ${normalized.codigo} conflicts with an existing record`, unitCode, unitCode));
        }
        continue;
      }

      const categoryName = this.resolveCategoryName(normalized);
      const existingCategory = buildingId && categoryName ? categoriesByBuildingAndName.get(`${buildingId}:${categoryName}`) : undefined;
      if (existingCategory) {
        if (this.compareNullableNumber(existingCategory.coefficient, normalized.coeficiente)) {
          this.bump(summary.units, 'reusable');
          unitStatusByKey.set(rowKey, 'reusable');
        } else {
          this.bump(summary.units, 'conflict');
          unitStatusByKey.set(rowKey, 'conflict');
          issues.push(this.makeIssue(row.sheet, row.rowNumber, 'coeficiente', 'CONFLICT_WITH_DB', 'BLOCKER', `Category ${categoryName} conflicts with an existing coefficient`, String(normalized.coeficiente ?? ''), String(existingCategory.coefficient)));
        }
        continue;
      }

      this.bump(summary.units, 'new');
      unitStatusByKey.set(rowKey, 'new');
    }

    const personRefs = await this.prisma.externalEntityReference.findMany({
      where: {
        tenantId,
        source: 'onboarding-import',
        entityType: {
          in: ['PERSON', 'PERSON_DOCUMENT'],
        },
      },
      select: { entityType: true, externalCode: true, entityId: true },
    });
    const personRefByCode = new Map(
      personRefs
        .filter((ref) => ref.entityType === 'PERSON')
        .map((ref) => [this.normalizeCode(ref.externalCode), ref] as const),
    );
    const personRefByDocument = new Map(
      personRefs
        .filter((ref) => ref.entityType === 'PERSON_DOCUMENT')
        .map((ref) => [this.normalizeDocument(ref.externalCode), ref] as const),
    );

    const personEmails = Array.from(new Set(data.people.flatMap((row) => (row.normalized?.email ? [this.normalizeEmail(row.normalized.email)] : []))));
    const personPhones = Array.from(new Set(data.people.flatMap((row) => (row.normalized?.telefono ? [this.normalizeText(row.normalized.telefono)] : [])).filter((phone): phone is string => Boolean(phone))));
    const referencedMemberIds = Array.from(new Set(personRefs.map((ref) => ref.entityId)));

    const tenantMemberWhere: Prisma.TenantMemberWhereInput = { tenantId };
    const tenantMemberOr: Prisma.TenantMemberWhereInput[] = [];
    if (personEmails.length > 0) {
      tenantMemberOr.push({ email: { in: personEmails } });
    }
    if (personPhones.length > 0) {
      tenantMemberOr.push({ phone: { in: personPhones } });
    }
    if (referencedMemberIds.length > 0) {
      tenantMemberOr.push({ id: { in: referencedMemberIds } });
    }
    if (tenantMemberOr.length > 0) {
      tenantMemberWhere.OR = tenantMemberOr;
    }

    const tenantMembers = await this.prisma.tenantMember.findMany({
      where: tenantMemberWhere,
      select: { id: true, tenantId: true, name: true, email: true, phone: true, role: true, status: true },
    });

    const usersByEmail = personEmails.length > 0
      ? await this.prisma.user.findMany({
          where: { email: { in: personEmails } },
          select: { id: true, email: true, name: true },
        })
      : [];

    const userByEmail = new Map(usersByEmail.map((user) => [this.normalizeEmail(user.email), user] as const));
    const memberByEmail = new Map(tenantMembers.filter((member) => member.email).map((member) => [this.normalizeEmail(member.email ?? ''), member] as const));
    const memberByPhone = new Map(tenantMembers.filter((member) => member.phone).map((member) => [this.normalizeText(member.phone ?? ''), member] as const));
    const memberById = new Map(tenantMembers.map((member) => [member.id, member] as const));
    const personEmailOwners = new Map<string, string>();
    const personPhoneOwners = new Map<string, string>();
    const personDocumentOwners = new Map<string, string>();

    const personRowsByCode = new Map<string, ParsedRow<ParsedPersonRowRaw, ParsedPersonRowNormalized>>();
    const personStatusByCode = new Map<string, 'new' | 'reusable' | 'conflict' | 'invalid'>();
    for (const row of data.people) {
      const normalized = row.normalized;
      if (!normalized) {
        this.bump(summary.people, 'invalid');
        continue;
      }

      const code = this.normalizeCode(normalized.personaCodigo);
      if (personRowsByCode.has(code)) {
        this.bump(summary.people, 'conflict');
        personStatusByCode.set(code, 'conflict');
        issues.push(this.makeIssue(row.sheet, row.rowNumber, 'persona_codigo', 'DUPLICATE_IN_FILE', 'BLOCKER', `Duplicate person code: ${code}`, code, code));
        continue;
      }
      personRowsByCode.set(code, row);

      const existingRef = personRefByCode.get(code);
      const normalizedDocument = normalized.documento ? this.normalizeDocument(normalized.documento) : null;
      const normalizedEmail = normalized.email ? this.normalizeEmail(normalized.email) : null;
      const normalizedPhone = normalized.telefono ? this.normalizeText(normalized.telefono) : null;
      const existingDocumentRef = normalizedDocument ? personRefByDocument.get(normalizedDocument) : undefined;
      const existingMember = existingRef ? memberById.get(existingRef.entityId) : undefined;
      const existingDocumentMember = existingDocumentRef ? memberById.get(existingDocumentRef.entityId) : undefined;
      const existingEmailMember = normalizedEmail ? memberByEmail.get(normalizedEmail) : undefined;
      const existingPhoneMember = normalizedPhone ? memberByPhone.get(normalizedPhone) : undefined;
      const existingUser = normalizedEmail ? userByEmail.get(normalizedEmail) : undefined;

      if (normalizedEmail) {
        const previousCode = personEmailOwners.get(normalizedEmail);
        if (previousCode && previousCode !== code) {
          this.bump(summary.people, 'conflict');
          personStatusByCode.set(code, 'conflict');
          issues.push(this.makeIssue(row.sheet, row.rowNumber, 'email', 'DUPLICATE_IN_FILE', 'BLOCKER', `Duplicate person email in file: ${normalizedEmail}`, normalizedEmail, normalizedEmail));
          continue;
        }

        personEmailOwners.set(normalizedEmail, code);
      }

      if (normalizedPhone) {
        const previousCode = personPhoneOwners.get(normalizedPhone);
        if (previousCode && previousCode !== code) {
          this.bump(summary.people, 'conflict');
          personStatusByCode.set(code, 'conflict');
          issues.push(this.makeIssue(row.sheet, row.rowNumber, 'telefono', 'DUPLICATE_IN_FILE', 'BLOCKER', `Duplicate person phone in file: ${normalizedPhone}`, normalizedPhone, normalizedPhone));
          continue;
        }

        personPhoneOwners.set(normalizedPhone, code);
      }

      if (normalizedDocument) {
        const previousCode = personDocumentOwners.get(normalizedDocument);
        if (previousCode && previousCode !== code) {
          this.bump(summary.people, 'conflict');
          personStatusByCode.set(code, 'conflict');
          issues.push(this.makeIssue(row.sheet, row.rowNumber, 'documento', 'DUPLICATE_IN_FILE', 'BLOCKER', `Duplicate person document in file: ${normalizedDocument}`, normalizedDocument, normalizedDocument));
          continue;
        }

        personDocumentOwners.set(normalizedDocument, code);
      }

      if (existingRef && !existingMember) {
        this.bump(summary.people, 'conflict');
        personStatusByCode.set(code, 'conflict');
        issues.push(this.makeIssue(row.sheet, row.rowNumber, 'persona_codigo', 'CONFLICT_WITH_DB', 'BLOCKER', `Person ${code} references a missing tenant member`, code, code));
        continue;
      }

      if (existingRef) {
        this.bump(summary.people, 'reusable');
        personStatusByCode.set(code, 'reusable');
        continue;
      }

      const sameName = [existingEmailMember?.name, existingPhoneMember?.name, existingDocumentMember?.name, existingUser?.name].some((name) => name ? this.normalizeText(name) === this.normalizeText(normalized.nombre) : false);
      const sameIdentity = Boolean(
        (normalizedEmail && (
          (existingEmailMember && this.normalizeEmail(existingEmailMember.email ?? '') === normalizedEmail) ||
          (existingUser && this.normalizeEmail(existingUser.email) === normalizedEmail)
        )) ||
        (normalizedPhone && existingPhoneMember && this.normalizeText(existingPhoneMember.phone ?? '') === normalizedPhone) ||
        (normalizedDocument && existingDocumentMember && existingDocumentRef && this.normalizeDocument(existingDocumentRef.externalCode) === normalizedDocument)
      );

      if (sameName && sameIdentity) {
        this.bump(summary.people, 'reusable');
        personStatusByCode.set(code, 'reusable');
        continue;
      }

      if (existingEmailMember || existingPhoneMember || existingDocumentMember || existingUser || existingDocumentRef) {
        this.bump(summary.people, 'conflict');
        personStatusByCode.set(code, 'conflict');
        const conflictColumn = existingEmailMember || existingUser ? 'email' : existingPhoneMember ? 'telefono' : 'documento';
        issues.push(this.makeIssue(
          row.sheet,
          row.rowNumber,
          conflictColumn,
          'CONFLICT_WITH_DB',
          'BLOCKER',
          'La persona entra en conflicto con una identidad existente del tenant',
          conflictColumn === 'email' ? normalizedEmail : conflictColumn === 'telefono' ? normalizedPhone : normalizedDocument,
          conflictColumn === 'email' ? normalizedEmail : conflictColumn === 'telefono' ? normalizedPhone : normalizedDocument,
        ));
        continue;
      }

      this.bump(summary.people, 'new');
      personStatusByCode.set(code, 'new');
    }

    const occupantRows = await this.prisma.unitOccupant.findMany({
      where: {
        tenantId,
        unit: {
          buildingId: { in: existingBuildings.map((building) => building.id) },
        },
      },
      select: { unitId: true, memberId: true, role: true, isPrimary: true, startDate: true, endDate: true },
    });
    const occupantByUnitAndMember = new Map<string, ExistingOccupantRecord>();
    for (const occupant of occupantRows) {
      occupantByUnitAndMember.set(`${occupant.unitId}:${occupant.memberId}`, occupant);
    }

    const relationKeySet = new Set<string>();
    const principalByUnit = new Map<string, number>();
    for (const row of data.relations) {
      const normalized = row.normalized;
      if (!normalized) {
        this.bump(summary.relations, 'invalid');
        continue;
      }

      const personCode = this.normalizeCode(normalized.personaCodigo);
      const buildingCode = this.normalizeCode(normalized.edificioCodigo);
      const unitCode = this.normalizeCode(normalized.unidadCodigo);
      const unitKey = `${buildingCode}:${unitCode}`;
      const buildingId = buildingIdByCode.get(buildingCode);
      const unitId = buildingId ? unitIdByBuildingAndCode.get(`${buildingId}:${unitCode}`) : undefined;
      const buildingKnown = Boolean(buildingRowsByCode.get(buildingCode) || buildingId);
      const personStatus = personStatusByCode.get(personCode);
      const unitStatus = unitStatusByKey.get(unitKey);
      const personRow = personRowsByCode.get(personCode);

      if (!buildingKnown || !unitStatus || unitStatus === 'invalid' || unitStatus === 'conflict') {
        this.bump(summary.relations, 'invalid');
        issues.push(this.makeIssue(row.sheet, row.rowNumber, 'unidad_codigo', 'UNKNOWN_UNIT', 'BLOCKER', 'The related unit is not available', normalized.unidadCodigo, unitKey));
        continue;
      }

      if (!personStatus || personStatus === 'invalid' || personStatus === 'conflict' || !personRow) {
        this.bump(summary.relations, 'invalid');
        issues.push(this.makeIssue(row.sheet, row.rowNumber, 'persona_codigo', 'UNKNOWN_PERSON', 'BLOCKER', 'The related person is not available', normalized.personaCodigo, normalized.personaCodigo));
        continue;
      }

      const relationKey = `${personCode}:${unitKey}:${normalized.rol}:${normalized.principal ? '1' : '0'}`;
      if (relationKeySet.has(relationKey)) {
        this.bump(summary.relations, 'conflict');
        issues.push(this.makeIssue(row.sheet, row.rowNumber, 'persona_codigo', 'DUPLICATE_IN_FILE', 'BLOCKER', 'Duplicate relationship in file', relationKey, relationKey));
        continue;
      }
      relationKeySet.add(relationKey);

      if (normalized.principal) {
        const currentPrincipalCount = principalByUnit.get(unitKey) ?? 0;
        if (currentPrincipalCount > 0) {
          this.bump(summary.relations, 'conflict');
          issues.push(this.makeIssue(row.sheet, row.rowNumber, 'principal', 'MULTIPLE_PRINCIPAL', 'BLOCKER', 'More than one principal occupant for the same unit', 'SI', 'SI'));
          continue;
        }

        principalByUnit.set(unitKey, currentPrincipalCount + 1);
      }

      const normalizedPerson = personRow.normalized;
      if (!normalizedPerson) {
        this.bump(summary.relations, 'invalid');
        continue;
      }

      const existingMember = normalizedPerson.email ? memberByEmail.get(this.normalizeEmail(normalizedPerson.email)) : undefined;
      const existingOccupant = unitId && existingMember ? occupantByUnitAndMember.get(`${unitId}:${existingMember.id}`) : undefined;
      if (existingOccupant) {
        const sameRelation =
          this.normalizeText(existingOccupant.role) === this.normalizeText(normalized.rol) &&
          existingOccupant.isPrimary === normalized.principal &&
          this.sameCalendarDate(existingOccupant.startDate, normalized.startDate);

        if (sameRelation) {
          this.bump(summary.relations, 'reusable');
        } else {
          this.bump(summary.relations, 'conflict');
          issues.push(this.makeIssue(row.sheet, row.rowNumber, 'persona_codigo', 'CONFLICT_WITH_DB', 'BLOCKER', 'An equivalent unit occupancy already exists with different attributes', normalized.personaCodigo, `${unitKey}:${existingMember?.id ?? 'unknown'}`));
        }
        continue;
      }

      this.bump(summary.relations, 'new');
    }

    const existingCharges = await this.prisma.charge.findMany({
      where: {
        tenantId,
        buildingId: { in: existingBuildings.map((building) => building.id) },
      },
      select: {
        buildingId: true,
        unitId: true,
        period: true,
        concept: true,
        amount: true,
        currency: true,
        status: true,
      },
    });
    const chargesByKey = new Map<string, ExistingChargeRecord>();
    for (const charge of existingCharges) {
      chargesByKey.set(`${charge.buildingId}:${charge.unitId}:${charge.period}:${this.normalizeText(charge.concept)}:${charge.currency}`, charge);
    }
    const currentPeriod = this.getCurrentPeriod();

    for (const row of data.openingBalances) {
      const normalized = row.normalized;
      if (!normalized) {
        this.bump(summary.openingBalances, 'invalid');
        continue;
      }

      const buildingCode = this.normalizeCode(normalized.edificioCodigo);
      const unitCode = this.normalizeCode(normalized.unidadCodigo);
      const buildingId = buildingIdByCode.get(buildingCode);
      const unitId = buildingId ? unitIdByBuildingAndCode.get(`${buildingId}:${unitCode}`) : undefined;
      const buildingKnown = Boolean(buildingRowsByCode.get(buildingCode) || buildingId);
      const unitStatus = unitStatusByKey.get(`${buildingCode}:${unitCode}`);

      if (!buildingKnown || !unitStatus || unitStatus === 'invalid' || unitStatus === 'conflict') {
        this.bump(summary.openingBalances, 'invalid');
        issues.push(this.makeIssue(row.sheet, row.rowNumber, 'unidad_codigo', 'UNKNOWN_UNIT', 'BLOCKER', 'The referenced unit does not exist yet', normalized.unidadCodigo, `${buildingCode}:${unitCode}`));
        continue;
      }

      if (normalized.currency !== tenantCurrency) {
        this.bump(summary.openingBalances, 'conflict');
        issues.push(this.makeIssue(row.sheet, row.rowNumber, 'moneda', 'CURRENCY_MISMATCH', 'BLOCKER', 'Currency does not match tenant currency', normalized.currency, tenantCurrency));
        continue;
      }

      if (normalized.period > currentPeriod) {
        this.bump(summary.openingBalances, 'invalid');
        issues.push(this.makeIssue(row.sheet, row.rowNumber, 'periodo', 'FUTURE_PERIOD', 'BLOCKER', 'Opening balance period cannot be in the future', normalized.period, currentPeriod));
        continue;
      }

      const key = `${buildingId}:${unitId}:${normalized.period}:${this.normalizeText(normalized.concept)}:${normalized.currency}`;
      const existingCharge = unitId ? chargesByKey.get(key) : undefined;
      if (existingCharge) {
        if (existingCharge.amount === normalized.amountMinor && existingCharge.currency === normalized.currency && existingCharge.status !== 'CANCELED') {
          this.bump(summary.openingBalances, 'reusable');
        } else {
          this.bump(summary.openingBalances, 'conflict');
          issues.push(this.makeIssue(row.sheet, row.rowNumber, 'monto', 'CONFLICT_WITH_DB', 'BLOCKER', 'An equivalent charge already exists', String(normalized.amountMinor), String(existingCharge.amount)));
        }
        continue;
      }

      this.bump(summary.openingBalances, 'new');
    }

    summary.blockingIssues = issues.filter((issue) => issue.severity === 'BLOCKER').length;
    summary.warnings = issues.filter((issue) => issue.severity === 'WARNING').length;

    return { summary, issues };
  }

  private async persistJob(payload: JobCreatePayload): Promise<ImportJobView> {
    try {
      const job = await this.prisma.$transaction(async (tx) => {
        const created = await tx.importJob.create({
          data: {
            id: payload.importId,
            tenantId: payload.tenantId,
            type: ONBOARDING_IMPORT_TYPE,
            status: payload.status,
            schemaVersion: ONBOARDING_IMPORT_SCHEMA_VERSION,
            previewVersion: payload.previewVersion,
            fileName: payload.fileName,
            fileSize: payload.fileSize,
            fileMimeType: payload.fileMimeType,
            fileHash: payload.fileHash,
            previewHash: payload.previewHash,
            originalObjectKey: payload.originalObjectKey,
            normalizedObjectKey: payload.normalizedObjectKey,
            summary: payload.summary as unknown as Prisma.JsonObject,
            counts: payload.summary as unknown as Prisma.JsonObject,
            canConfirm: payload.canConfirm,
            expiresAt: this.getExpirationDate(),
          },
          include: {
            issues: {
              select: { id: true },
            },
          },
        });

        if (payload.issues.length > 0) {
          await tx.importIssue.createMany({
            data: payload.issues.map((issue) => ({
              tenantId: payload.tenantId,
              importJobId: created.id,
              sheet: issue.sheet,
              row: issue.row,
              column: issue.column,
              code: issue.code,
              severity: issue.severity,
              message: issue.message,
              receivedValue: issue.receivedValue,
              normalizedValue: issue.normalizedValue,
            })),
          });
        }

        return created;
      });

      return this.mapJobView(job);
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        const existing = await this.findExistingJob(payload.tenantId, payload.fileHash);
        if (existing) {
          return existing;
        }
      }

      throw error;
    }
  }

  private async persistFailedImport(input: {
    tenantId: string;
    membershipId: string | null;
    importId: string;
    fileName: string;
    fileSize: number;
    fileHash: string;
    fileMimeType: string;
    originalObjectKey: string;
    error: unknown;
  }): Promise<void> {
    try {
      const summary = this.createEmptySummary();
      const errorCode = this.sanitizeErrorCode(input.error);
      const errorMessage = this.sanitizeErrorMessage(input.error);

      await this.prisma.importJob.upsert({
        where: {
          tenantId_type_schemaVersion_previewVersion_fileHash: {
            tenantId: input.tenantId,
            type: ONBOARDING_IMPORT_TYPE,
            schemaVersion: ONBOARDING_IMPORT_SCHEMA_VERSION,
            previewVersion: ONBOARDING_IMPORT_PREVIEW_VERSION,
            fileHash: input.fileHash,
          },
        },
        update: {
          status: ImportJobStatus.FAILED,
          errorCode,
          errorMessage,
          previewVersion: ONBOARDING_IMPORT_PREVIEW_VERSION,
          previewHash: null,
          summary: summary as unknown as Prisma.JsonObject,
          counts: summary as unknown as Prisma.JsonObject,
          canConfirm: false,
          fileName: input.fileName,
          fileSize: input.fileSize,
          fileMimeType: input.fileMimeType,
          originalObjectKey: input.originalObjectKey,
          normalizedObjectKey: null,
          createdByMembershipId: input.membershipId,
        },
        create: {
          id: input.importId,
          tenantId: input.tenantId,
          type: ONBOARDING_IMPORT_TYPE,
          status: ImportJobStatus.FAILED,
          schemaVersion: ONBOARDING_IMPORT_SCHEMA_VERSION,
          previewVersion: ONBOARDING_IMPORT_PREVIEW_VERSION,
          fileName: input.fileName,
          fileSize: input.fileSize,
          fileMimeType: input.fileMimeType,
          fileHash: input.fileHash,
          previewHash: null,
          originalObjectKey: input.originalObjectKey,
          normalizedObjectKey: null,
          summary: summary as unknown as Prisma.JsonObject,
          counts: summary as unknown as Prisma.JsonObject,
          canConfirm: false,
          expiresAt: this.getExpirationDate(),
          errorCode,
          errorMessage,
          createdByMembershipId: input.membershipId,
        },
      });
    } catch {
      // Best effort only.
    }
  }

  private async findExistingJob(tenantId: string, fileHash: string): Promise<ImportJobView | null> {
    const job = await this.prisma.importJob.findUnique({
      where: {
        tenantId_type_schemaVersion_previewVersion_fileHash: {
          tenantId,
          type: ONBOARDING_IMPORT_TYPE,
          schemaVersion: ONBOARDING_IMPORT_SCHEMA_VERSION,
          previewVersion: ONBOARDING_IMPORT_PREVIEW_VERSION,
          fileHash,
        },
      },
      include: {
        issues: {
          select: { id: true },
        },
      },
    });

    return job ? this.mapJobView(job) : null;
  }

  private async uploadOriginalFile(objectKey: string, buffer: Buffer, mimeType: string): Promise<void> {
    if (!ONBOARDING_IMPORT_ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new UnsupportedMediaTypeException('Solo se permite subir archivos .xlsx');
    }

    if (buffer.length > ONBOARDING_IMPORT_MAX_FILE_SIZE_BYTES) {
      throw new PayloadTooLargeException(`El archivo supera el máximo de ${ONBOARDING_IMPORT_MAX_FILE_SIZE_BYTES} bytes`);
    }

    await this.minio.uploadBuffer(undefined, objectKey, buffer, mimeType);
  }

  private assertFile(file: UploadableSpreadsheetFile | undefined): UploadableSpreadsheetFile {
    if (!file) {
      throw new BadRequestException('Debe enviar un archivo .xlsx');
    }

    const sanitizedName = this.normalizer.sanitizeFileName(file.originalname);
    if (!sanitizedName.toLowerCase().endsWith('.xlsx')) {
      throw new UnsupportedMediaTypeException('Solo se aceptan archivos .xlsx');
    }

    if (!ONBOARDING_IMPORT_ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new UnsupportedMediaTypeException('MIME type no soportado para importación');
    }

    return file;
  }

  private buildObjectKeys(tenantId: string, importId: string): StoredImportObjectKeys {
    return {
      originalObjectKey: `${ONBOARDING_IMPORT_OBJECT_KEY_PREFIX}/${tenantId}/${importId}/original.xlsx`,
      normalizedObjectKey: `${ONBOARDING_IMPORT_OBJECT_KEY_PREFIX}/${tenantId}/${importId}/normalized.json`,
    };
  }

  private buildNormalizedPayload(
    tenantId: string,
    importId: string,
    fileHash: string,
    fileName: string,
    validation: ValidationResult,
    data: ParsedWorkbookData,
  ): Record<string, unknown> {
    return {
      importId,
      tenantId,
      type: ONBOARDING_IMPORT_TYPE,
      schemaVersion: ONBOARDING_IMPORT_SCHEMA_VERSION,
      fileHash,
      fileName,
      summary: validation.summary,
      issues: validation.issues,
      data,
    };
  }

  private mapJobView(job: {
    id: string;
    tenantId: string;
    type: ImportType;
    fileName: string;
    fileHash: string;
    schemaVersion: string;
    previewVersion: number;
    status: ImportJobStatus;
    canConfirm: boolean;
    expiresAt: Date;
    confirmedAt: Date | null;
    confirmedByMembershipId: string | null;
    createdAt: Date;
    updatedAt: Date;
    summary: Prisma.JsonValue | null;
    counts: Prisma.JsonValue | null;
    issues: Array<{ id: string }>;
  }): ImportJobView {
    const summary = this.coerceSummary(job.summary);
    const counts = this.coerceSummary(job.counts);
    const status = job.status === ImportJobStatus.READY && job.expiresAt < new Date() ? 'EXPIRED' : job.status;

    return {
      importId: job.id,
      tenantId: job.tenantId,
      type: job.type,
      fileName: job.fileName,
      fileHash: job.fileHash,
      schemaVersion: job.schemaVersion,
      previewVersion: job.previewVersion,
      status,
      expiresAt: job.expiresAt.toISOString(),
      canConfirm: status === ImportJobStatus.READY && job.canConfirm,
      summary,
      counts,
      issueCount: job.issues.length,
      blockingIssueCount: summary.blockingIssues,
      warningCount: summary.warnings,
      confirmedAt: job.confirmedAt ? job.confirmedAt.toISOString() : null,
      confirmedByMembershipId: job.confirmedByMembershipId,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }

  private coerceSummary(value: Prisma.JsonValue | null): ImportPreviewSummary {
    const empty = this.createEmptySummary();
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return empty;
    }

    const asRecord = value as Record<string, unknown>;
    return {
      buildings: this.coerceSheetStats(asRecord.buildings),
      units: this.coerceSheetStats(asRecord.units),
      people: this.coerceSheetStats(asRecord.people),
      relations: this.coerceSheetStats(asRecord.relations),
      openingBalances: this.coerceSheetStats(asRecord.openingBalances),
      blockingIssues: this.coerceNumber(asRecord.blockingIssues),
      warnings: this.coerceNumber(asRecord.warnings),
    };
  }

  private coerceSheetStats(value: unknown): ImportSheetStats {
    const empty = this.createSheetStats();
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return empty;
    }

    const record = value as Record<string, unknown>;
    return {
      total: this.coerceNumber(record.total),
      new: this.coerceNumber(record.new),
      reusable: this.coerceNumber(record.reusable),
      conflict: this.coerceNumber(record.conflict),
      invalid: this.coerceNumber(record.invalid),
    };
  }

  private createEmptySummary(): ImportPreviewSummary {
    return {
      buildings: this.createSheetStats(),
      units: this.createSheetStats(),
      people: this.createSheetStats(),
      relations: this.createSheetStats(),
      openingBalances: this.createSheetStats(),
      blockingIssues: 0,
      warnings: 0,
    };
  }

  private createSheetStats(): ImportSheetStats {
    return {
      total: 0,
      new: 0,
      reusable: 0,
      conflict: 0,
      invalid: 0,
    };
  }

  private bump(summary: ImportSheetStats, key: keyof ImportSheetStats): void {
    summary.total += 1;
    summary[key] += 1;
  }

  private computeHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  private getExpirationDate(): Date {
    const expires = new Date();
    expires.setDate(expires.getDate() + ONBOARDING_IMPORT_EXPIRES_DAYS);
    return expires;
  }

  private normalizeText(value: string): string {
    return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  }

  private normalizeCode(value: string): string {
    return this.normalizeText(value).toUpperCase();
  }

  private normalizeEmail(value: string): string {
    return this.normalizeText(value).toLowerCase();
  }

  private normalizeDocument(value: string): string {
    return this.normalizeText(value).toUpperCase();
  }

  private compareNullableNumber(left: number | null, right: number | null): boolean {
    if (left === null && right === null) {
      return true;
    }

    if (left === null || right === null) {
      return false;
    }

    return Math.abs(left - right) < 0.0001;
  }

  private resolveCategoryName(row: ParsedUnitRowNormalized): string | null {
    if (row.categoriaNombre) {
      return this.normalizeText(row.categoriaNombre);
    }

    if (row.coeficiente !== null) {
      return `COEF_${row.coeficiente}`;
    }

    return null;
  }

  private getCurrentPeriod(): string {
    const date = new Date();
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  private coerceNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private sanitizeErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message.slice(0, 200);
    }

    return String(error).slice(0, 200);
  }

  private sanitizeErrorCode(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = String((error as { code?: unknown }).code ?? 'IMPORT_ERROR');
      return code.slice(0, 80);
    }

    return 'IMPORT_ERROR';
  }

  private isUniqueConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private rethrow(error: unknown): never {
    if (error instanceof Error) {
      throw error;
    }

    throw new Error(this.sanitizeErrorMessage(error));
  }

  private async cleanupImportObjects(keys: StoredImportObjectKeys): Promise<void> {
    await Promise.allSettled([
      this.minio.deleteObject(undefined, keys.originalObjectKey),
      this.minio.deleteObject(undefined, keys.normalizedObjectKey),
    ]);
  }

  private sameCalendarDate(left: Date, rightIsoDate: string): boolean {
    return left.toISOString().slice(0, 10) === rightIsoDate.slice(0, 10);
  }

  private makeIssue(
    sheet: ImportSheetName,
    row: number | null,
    column: string | null,
    code: string,
    severity: ImportIssueSeverity,
    message: string,
    receivedValue: string | null,
    normalizedValue: string | null,
  ): ImportIssueRecord {
    return {
      sheet,
      row,
      column,
      code,
      severity,
      message,
      receivedValue,
      normalizedValue,
    };
  }
}
