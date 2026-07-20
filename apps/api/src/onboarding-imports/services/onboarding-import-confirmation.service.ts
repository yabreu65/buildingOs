import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AuditAction,
  ChargeStatus,
  ChargeType,
  ImportJobStatus,
  Prisma,
  Role,
  UnitOccupantRole,
  MemberStatus,
} from '@prisma/client';
import { createHash } from 'crypto';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../../storage/minio.service';
import {
  ONBOARDING_IMPORT_CONFIRM_LOCK_TIMEOUT_MS,
  ONBOARDING_IMPORT_CONFIRM_TRANSACTION_MAX_WAIT_MS,
  ONBOARDING_IMPORT_CONFIRM_TRANSACTION_TIMEOUT_MS,
  ONBOARDING_IMPORT_SCHEMA_VERSION,
} from '../onboarding-imports.constants';
import type {
  ConfirmOnboardingImportRequest,
  ConfirmOnboardingImportResult,
  ConfirmOnboardingImportSummary,
  ImportPreviewSummary,
  ImportSheetName,
  ImportIssueRecord,
  ParsedBuildingRowNormalized,
  ParsedBuildingRowRaw,
  ParsedPersonRowNormalized,
  ParsedPersonRowRaw,
  ParsedOpeningBalanceRowRaw,
  ParsedRow,
  ParsedUnitRelationRowNormalized,
  ParsedUnitRelationRowRaw,
  ParsedUnitRowNormalized,
  ParsedUnitRowRaw,
  ParsedWorkbookData,
} from '../types/onboarding-import.types';
import { OnboardingImportNormalizerService } from './onboarding-import-normalizer.service';
import type { AuthenticatedUser } from '../../common/types/request.types';

interface ConfirmImportAccessContext {
  readonly tenantId: string;
  readonly tenantCurrency: string;
  readonly userId: string;
  readonly membershipId: string | null;
  readonly roles: Role[];
  readonly isSuperAdmin: boolean;
}

interface ConfirmImportInput extends ConfirmImportAccessContext {
  readonly importId: string;
  readonly expectedPreviewVersion?: number;
  readonly confirmationToken?: string;
}

interface ConfirmNormalizedPayload {
  readonly importId: string;
  readonly tenantId: string;
  readonly type: string;
  readonly schemaVersion: string;
  readonly fileHash: string;
  readonly fileName: string;
  readonly summary: ImportPreviewSummary;
  readonly issues: ImportIssueRecord[];
  readonly data: ParsedWorkbookData;
}

interface ImportJobConfirmationRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly status: ImportJobStatus;
  readonly schemaVersion: string;
  readonly previewVersion: number;
  readonly fileHash: string;
  readonly previewHash: string | null;
  readonly normalizedObjectKey: string | null;
  readonly canConfirm: boolean;
  readonly expiresAt: Date;
  readonly confirmingAt: Date | null;
  readonly confirmingLockExpiresAt: Date | null;
  readonly confirmingByMembershipId: string | null;
  readonly confirmedAt: Date | null;
  readonly confirmedByMembershipId: string | null;
  readonly confirmationSummary: Prisma.JsonValue | null;
  readonly confirmationResult: Prisma.JsonValue | null;
}

interface BuildingRecord {
  readonly id: string;
  readonly alias: string;
  readonly name: string;
  readonly address: string | null;
  readonly deletedAt: Date | null;
}

interface UnitCategoryRecord {
  readonly id: string;
  readonly buildingId: string;
  readonly name: string;
  readonly minM2: number;
  readonly maxM2: number | null;
  readonly coefficient: number;
  readonly active: boolean;
}

interface UnitRecord {
  readonly id: string;
  readonly buildingId: string;
  readonly code: string;
  readonly label: string | null;
  readonly unitType: string;
  readonly m2: number | null;
  readonly isBillable: boolean;
  readonly occupancyStatus: string | null;
  readonly unitCategoryId: string | null;
}

interface TenantMemberRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string | null;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly role: Role;
  readonly status: MemberStatus;
}

interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
}

interface ExternalReferenceRecord {
  readonly entityType: string;
  readonly externalCode: string;
  readonly entityId: string;
}

interface OccupantRecord {
  readonly unitId: string;
  readonly memberId: string;
  readonly role: UnitOccupantRole;
  readonly isPrimary: boolean;
  readonly startDate: Date;
  readonly endDate: Date | null;
}

interface ChargeRecord {
  readonly id: string;
  readonly unitId: string;
  readonly period: string;
  readonly concept: string;
  readonly amount: number;
  readonly currency: string;
  readonly type: ChargeType;
  readonly dueDate: Date;
  readonly importJobId: string | null;
}

interface ConfirmationSummaryCounter {
  created: number;
  reused: number;
}

interface WorkingConfirmationSummary extends ConfirmOnboardingImportSummary {
  readonly buildings: ConfirmationSummaryCounter;
  readonly unitCategories: ConfirmationSummaryCounter;
  readonly units: ConfirmationSummaryCounter;
  readonly people: ConfirmationSummaryCounter;
  readonly relations: ConfirmationSummaryCounter;
  readonly charges: ConfirmationSummaryCounter;
}

interface ConfirmationResultPayload {
  readonly importId: string;
  readonly status: 'CONFIRMED';
  readonly confirmedAt: string;
  readonly summary: ConfirmOnboardingImportSummary;
}

@Injectable()
export class OnboardingImportConfirmationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly auditService: AuditService,
    private readonly normalizer: OnboardingImportNormalizerService,
  ) {}

  async confirmImport(input: ConfirmImportInput): Promise<ConfirmOnboardingImportResult> {
    const currentJob = await this.prisma.importJob.findFirst({
      where: {
        id: input.importId,
        tenantId: input.tenantId,
      },
      include: {
        issues: { select: { id: true } },
      },
    });

    if (!currentJob) {
      throw new NotFoundException('Importación no encontrada');
    }

    if (currentJob.status === ImportJobStatus.CONFIRMED) {
      void this.auditService.createLog({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        actorMembershipId: input.membershipId ?? undefined,
        action: AuditAction.IMPORT_RECONFIRM_ATTEMPT,
        entityType: 'ImportJob',
        entityId: currentJob.id,
        metadata: {
          status: currentJob.status,
          confirmedAt: currentJob.confirmedAt?.toISOString() ?? null,
        },
      });

      return this.mapConfirmationResponse(currentJob);
    }

    this.assertConfirmableState(currentJob);

    if (input.expectedPreviewVersion !== undefined && input.expectedPreviewVersion !== currentJob.previewVersion) {
      throw new ConflictException('La vista previa quedó desactualizada; genere una nueva confirmación');
    }

    const normalizedPayload = await this.loadNormalizedPayload(currentJob);
    this.assertPayloadIntegrity(currentJob, normalizedPayload);

    const lockAcquired = await this.acquireConfirmationLock(currentJob, input.membershipId);
    if (!lockAcquired) {
      const refreshed = await this.prisma.importJob.findFirst({
        where: { id: currentJob.id, tenantId: input.tenantId },
        include: { issues: { select: { id: true } } },
      });

      if (refreshed?.status === ImportJobStatus.CONFIRMED) {
        return this.mapConfirmationResponse(refreshed);
      }

      throw new ConflictException('La importación ya está siendo confirmada por otra solicitud');
    }

    try {
      return await this.runConfirmationTransaction(input, currentJob, normalizedPayload);
    } catch (error) {
      await this.markConfirmationFailed(currentJob.id, input.tenantId, input.membershipId, error);
      throw this.rethrow(error);
    }
  }

  private async runConfirmationTransaction(
    input: ConfirmImportInput,
    currentJob: ImportJobConfirmationRecord,
    payload: ConfirmNormalizedPayload,
  ): Promise<ConfirmOnboardingImportResult> {
    let attempt = 0;

    while (attempt < 2) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const job = await tx.importJob.findFirst({
            where: { id: currentJob.id, tenantId: input.tenantId },
            include: { issues: { select: { id: true } } },
          });

          if (!job) {
            throw new NotFoundException('Importación no encontrada');
          }

          if (job.status === ImportJobStatus.CONFIRMED) {
            return this.mapConfirmationResponse(job);
          }

          if (job.status !== ImportJobStatus.CONFIRMING) {
            throw new ConflictException('La importación no está en estado confirmable');
          }

          if (job.confirmingLockExpiresAt && job.confirmingLockExpiresAt < new Date()) {
            throw new ConflictException('La confirmación anterior expiró; genere una nueva confirmación');
          }

          await this.auditService.createLogRequired(
            {
              tenantId: input.tenantId,
              actorUserId: input.userId,
              actorMembershipId: input.membershipId ?? undefined,
              action: AuditAction.IMPORT_CONFIRM_STARTED,
              entityType: 'ImportJob',
              entityId: job.id,
              metadata: {
                fileHash: job.fileHash,
                schemaVersion: job.schemaVersion,
                previewVersion: job.previewVersion,
              },
            },
            tx,
          );

          const summary = this.createWorkingSummary();
          const buildingMap = await this.confirmBuildings(tx, input, payload.data.buildings, summary);
          const categoryMap = await this.confirmCategories(tx, input, payload.data.units, buildingMap, summary);
          const unitMap = await this.confirmUnits(tx, input, payload.data.units, buildingMap, categoryMap, summary);
          const personMap = await this.confirmPeople(tx, input, payload.data.people, summary);
          await this.confirmRelations(tx, input, payload.data.relations, unitMap, personMap, summary);
          await this.confirmCharges(tx, input, payload.data.openingBalances, buildingMap, unitMap, summary);

          const confirmedAt = new Date();
          const result: ConfirmationResultPayload = {
            importId: job.id,
            status: 'CONFIRMED',
            confirmedAt: confirmedAt.toISOString(),
            summary: this.stripWorkingSummary(summary),
          };

          await tx.importJob.update({
            where: { id: job.id },
            data: {
              status: ImportJobStatus.CONFIRMED,
              confirmedAt,
              confirmedByMembershipId: input.membershipId ?? null,
              confirmationSummary: result.summary as unknown as Prisma.InputJsonObject,
              confirmationResult: result as unknown as Prisma.InputJsonObject,
              confirmingAt: null,
              confirmingLockExpiresAt: null,
              confirmingByMembershipId: null,
              canConfirm: false,
            },
          });

          await this.auditService.createLogRequired(
            {
              tenantId: input.tenantId,
              actorUserId: input.userId,
              actorMembershipId: input.membershipId ?? undefined,
              action: AuditAction.IMPORT_CONFIRMED,
              entityType: 'ImportJob',
              entityId: job.id,
              metadata: {
                confirmedAt: confirmedAt.toISOString(),
                summary: result.summary,
              },
            },
            tx,
          );

          return result;
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: ONBOARDING_IMPORT_CONFIRM_TRANSACTION_MAX_WAIT_MS,
          timeout: ONBOARDING_IMPORT_CONFIRM_TRANSACTION_TIMEOUT_MS,
        });
      } catch (error) {
        if (this.isSerializationConflict(error) && attempt === 0) {
          attempt += 1;
          continue;
        }

        if (this.isKnownImportP2002(error)) {
          throw new ConflictException('Se detectó un conflicto de identidad durante la confirmación');
        }

        throw error;
      }
    }

    throw new ConflictException('No se pudo confirmar la importación por una disputa transitoria');
  }

  private async confirmBuildings(
    tx: Prisma.TransactionClient,
    input: ConfirmImportInput,
    rows: ParsedWorkbookData['buildings'],
    summary: WorkingConfirmationSummary,
  ): Promise<Map<string, string>> {
    const buildingMap = new Map<string, string>();
    const existingBuildings = await tx.building.findMany({
      where: { tenantId: input.tenantId },
      select: { id: true, alias: true, name: true, address: true, deletedAt: true },
    });
    const existingByCode = new Map(existingBuildings.map((building) => [this.normalizeCode(building.alias), building] as const));

    for (const row of rows) {
      const normalized = this.requireNormalizedRow(row, 'Buildings');
      const code = this.normalizeCode(normalized.codigo);
      if (buildingMap.has(code)) {
        throw new ConflictException(`Building code duplicated in file: ${code}`);
      }

      const existing = existingByCode.get(code);
      if (existing) {
        if (existing.deletedAt) {
          throw new ConflictException(`Building ${code} was deleted`);
        }

        if (
          this.normalizeText(existing.name) !== this.normalizeText(normalized.nombre)
          || this.normalizeText(existing.address ?? '') !== this.normalizeText(normalized.direccion)
        ) {
          throw new ConflictException(`Building ${code} conflicts with the current database state`);
        }

        buildingMap.set(code, existing.id);
        summary.buildings.reused += 1;
        continue;
      }

      const created = await tx.building.create({
        data: {
          tenantId: input.tenantId,
          alias: code,
          name: normalized.nombre,
          address: normalized.direccion,
        },
      });

      buildingMap.set(code, created.id);
      summary.buildings.created += 1;

      await this.upsertExternalReference(tx, input.tenantId, 'BUILDING', code, created.id);
    }

    return buildingMap;
  }

  private async confirmCategories(
    tx: Prisma.TransactionClient,
    input: ConfirmImportInput,
    rows: ParsedWorkbookData['units'],
    buildingMap: Map<string, string>,
    summary: WorkingConfirmationSummary,
  ): Promise<Map<string, string>> {
    const categoryMap = new Map<string, string>();
    const categoriesByBuilding = new Map<string, ParsedWorkbookData['units']>();
    for (const row of rows) {
      const normalized = this.requireNormalizedRow(row, 'Units');
      const buildingCode = this.normalizeCode(normalized.edificioCodigo);
      const categoryName = this.resolveCategoryName(normalized);
      const key = `${buildingCode}::${categoryName}::${normalized.coeficiente ?? 'null'}`;
      const bucket = categoriesByBuilding.get(key) ?? [];
      bucket.push(row);
      categoriesByBuilding.set(key, bucket);
    }

    const buildingIds = Array.from(new Set(Array.from(buildingMap.values())));
    const existingCategories = await tx.unitCategory.findMany({
      where: {
        tenantId: input.tenantId,
        buildingId: { in: buildingIds },
      },
      select: { id: true, buildingId: true, name: true, minM2: true, maxM2: true, coefficient: true, active: true },
    });
    const existingByKey = new Map(existingCategories.map((category) => [`${category.buildingId}::${this.normalizeText(category.name)}`, category] as const));

    for (const [groupKey, groupRows] of categoriesByBuilding.entries()) {
      const [buildingCode, categoryName, coefficientKey = 'null'] = groupKey.split('::');
      if (!buildingCode || !categoryName) {
        throw new ConflictException('La agrupación de categorías de unidades no es válida');
      }
      const buildingId = buildingMap.get(buildingCode);
      if (!buildingId) {
        throw new NotFoundException(`El edificio ${buildingCode} no está disponible para resolver la categoría`);
      }

      const coefficient = this.requireNormalizedRow(groupRows[0]!, 'Units').coeficiente;
      if (coefficient === null || coefficient === undefined || coefficient <= 0) {
        throw new BadRequestException(`La categoría de unidad ${categoryName} requiere un coeficiente positivo`);
      }

      const existing = existingByKey.get(`${buildingId}::${this.normalizeText(categoryName)}`);
      const finiteM2 = groupRows
        .map((row) => this.requireNormalizedRow(row, 'Units').m2)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      const minM2 = finiteM2.length > 0 ? Math.min(...finiteM2) : null;
      const maxM2 = finiteM2.length > 0 ? Math.max(...finiteM2) : null;

      if (existing) {
        if (!existing.active) {
          throw new ConflictException(`La categoría de unidad ${categoryName} está inactiva`);
        }

        if (!this.compareNumbers(existing.coefficient, coefficient)) {
          throw new ConflictException(`La categoría de unidad ${categoryName} tiene un coeficiente distinto en la base de datos`);
        }

        if (minM2 !== null && !this.isRangeCompatible(existing.minM2, existing.maxM2, minM2, maxM2 ?? minM2)) {
          throw new ConflictException(`La categoría de unidad ${categoryName} no coincide con el rango actual de m²`);
        }

        categoryMap.set(`${buildingCode}::${this.normalizeText(categoryName)}::${coefficientKey}`, existing.id);
        summary.unitCategories.reused += 1;
        continue;
      }

      if (minM2 === null) {
        throw new UnprocessableEntityException(`La categoría de unidad ${categoryName} requiere al menos una unidad con m²`);
      }

      const rangeMax = maxM2 === null || maxM2 === minM2 ? minM2 + 0.01 : maxM2;
      await this.assertNoCategoryOverlap(tx, input.tenantId, buildingId, minM2, rangeMax, categoryName);

      const created = await tx.unitCategory.create({
        data: {
          tenantId: input.tenantId,
          buildingId,
          name: categoryName,
          minM2,
          maxM2: rangeMax,
          coefficient,
          active: true,
        },
      });

      categoryMap.set(`${buildingCode}::${this.normalizeText(categoryName)}::${coefficientKey}`, created.id);
      summary.unitCategories.created += 1;
    }

    return categoryMap;
  }

  private async confirmUnits(
    tx: Prisma.TransactionClient,
    input: ConfirmImportInput,
    rows: ParsedWorkbookData['units'],
    buildingMap: Map<string, string>,
    categoryMap: Map<string, string>,
    summary: WorkingConfirmationSummary,
  ): Promise<Map<string, string>> {
    const unitMap = new Map<string, string>();
    const buildingIds = Array.from(new Set(Array.from(buildingMap.values())));
    const existingUnits = await tx.unit.findMany({
      where: { tenantId: input.tenantId, buildingId: { in: buildingIds } },
      select: { id: true, buildingId: true, code: true, label: true, unitType: true, m2: true, isBillable: true, occupancyStatus: true, unitCategoryId: true },
    });
    const existingByKey = new Map(existingUnits.map((unit) => [`${unit.buildingId}::${this.normalizeCode(unit.code)}`, unit] as const));

    for (const row of rows) {
      const normalized = this.requireNormalizedRow(row, 'Units');
      const buildingCode = this.normalizeCode(normalized.edificioCodigo);
      const unitCode = this.normalizeCode(normalized.codigo);
      const buildingId = buildingMap.get(buildingCode);
      const categoryName = this.resolveCategoryName(normalized);
      const categoryId = categoryMap.get(`${buildingCode}::${this.normalizeText(categoryName)}::${normalized.coeficiente ?? 'null'}`);

      if (!buildingId) {
        throw new NotFoundException(`El edificio ${buildingCode} no está disponible para resolver unidades`);
      }

      const existing = existingByKey.get(`${buildingId}::${unitCode}`);
      const compatibleCategoryId = categoryId ?? null;
      const rowKey = `${buildingCode}::${unitCode}`;
      const expectedOccupancyStatus = this.resolveLegacyOccupancyStatus(normalized);

      if (existing) {
        const sameUnit =
          this.normalizeText(existing.label ?? '') === this.normalizeText(normalized.etiqueta ?? '')
          && this.normalizeText(existing.unitType) === this.normalizeText(normalized.tipo)
          && this.compareNullableNumbers(existing.m2, normalized.m2)
          && existing.isBillable === normalized.facturacion
          && this.normalizeText(existing.occupancyStatus ?? '') === expectedOccupancyStatus;

        if (!sameUnit) {
          throw new ConflictException(`Unit ${unitCode} conflicts with the current database state`);
        }

        if (existing.unitCategoryId && compatibleCategoryId && existing.unitCategoryId !== compatibleCategoryId) {
          throw new ConflictException(`Unit ${unitCode} has an incompatible category`);
        }

        if (!existing.unitCategoryId && compatibleCategoryId) {
          await tx.unit.update({
            where: { id: existing.id },
            data: { unitCategoryId: compatibleCategoryId },
          });
        }

        unitMap.set(rowKey, existing.id);
        summary.units.reused += 1;
        continue;
      }

      const created = await tx.unit.create({
        data: {
          tenantId: input.tenantId,
          buildingId,
          code: unitCode,
          label: normalized.etiqueta ?? undefined,
          unitType: normalized.tipo,
          occupancyStatus: expectedOccupancyStatus,
          m2: normalized.m2,
          isBillable: normalized.facturacion,
          unitCategoryId: compatibleCategoryId ?? undefined,
        },
      });

      unitMap.set(rowKey, created.id);
      summary.units.created += 1;

      await this.upsertExternalReference(tx, input.tenantId, 'UNIT', `${buildingCode}:${unitCode}`, created.id);
    }

    return unitMap;
  }

  private async confirmPeople(
    tx: Prisma.TransactionClient,
    input: ConfirmImportInput,
    rows: ParsedWorkbookData['people'],
    summary: WorkingConfirmationSummary,
  ): Promise<Map<string, string>> {
    const memberMap = new Map<string, string>();
    const personCodes = rows.map((row) => this.normalizeCode(this.requireNormalizedRow(row, 'People').personaCodigo));
    const personDocuments = Array.from(new Set(rows.map((row) => {
      const normalized = this.requireNormalizedRow(row, 'People');
      return normalized.documento ? this.normalizeDocument(normalized.documento) : null;
    }).filter((value): value is string => Boolean(value))));
    const emails = Array.from(new Set(rows.map((row) => {
      const normalized = this.requireNormalizedRow(row, 'People');
      return normalized.email ? this.normalizeEmail(normalized.email) : null;
    }).filter((value): value is string => Boolean(value))));
    const phones = Array.from(new Set(rows.map((row) => {
      const normalized = this.requireNormalizedRow(row, 'People');
      return normalized.telefono ? this.normalizeText(normalized.telefono) : null;
    }).filter((value): value is string => Boolean(value))));

    const existingRefs = await tx.externalEntityReference.findMany({
      where: {
        tenantId: input.tenantId,
        source: 'onboarding-import',
        entityType: { in: ['PERSON', 'PERSON_DOCUMENT'] },
        externalCode: { in: [...personCodes, ...personDocuments] },
      },
      select: { entityType: true, externalCode: true, entityId: true },
    });
    const documentRefMemberIds = Array.from(
      new Set(
        existingRefs
          .filter((ref) => ref.entityType === 'PERSON_DOCUMENT')
          .map((ref) => ref.entityId)
          .filter((entityId): entityId is string => Boolean(entityId)),
      ),
    );

    const [existingMembers, existingUsers] = await Promise.all([
      tx.tenantMember.findMany({
        where: {
          tenantId: input.tenantId,
          OR: [
            emails.length > 0 ? { email: { in: emails } } : undefined,
            phones.length > 0 ? { phone: { in: phones } } : undefined,
            documentRefMemberIds.length > 0 ? { id: { in: documentRefMemberIds } } : undefined,
          ].filter((value): value is NonNullable<typeof value> => Boolean(value)),
        },
        select: { id: true, tenantId: true, userId: true, name: true, email: true, phone: true, role: true, status: true },
      }),
      emails.length > 0 ? tx.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true, name: true } }) : Promise.resolve([]),
    ]);

    const refByCode = new Map(existingRefs.filter((ref) => ref.entityType === 'PERSON').map((ref) => [this.normalizeCode(ref.externalCode), ref] as const));
    const refByDocument = new Map(existingRefs.filter((ref) => ref.entityType === 'PERSON_DOCUMENT').map((ref) => [this.normalizeDocument(ref.externalCode), ref] as const));
    const memberByEmail = new Map(existingMembers.filter((member) => member.email).map((member) => [this.normalizeEmail(member.email ?? ''), member] as const));
    const memberByPhone = new Map(existingMembers.filter((member) => member.phone).map((member) => [this.normalizeText(member.phone ?? ''), member] as const));
    const memberById = new Map(existingMembers.map((member) => [member.id, member] as const));
    const userByEmail = new Map(existingUsers.map((user) => [this.normalizeEmail(user.email), user] as const));

    for (const row of rows) {
      const normalized = this.requireNormalizedRow(row, 'People');
      const code = this.normalizeCode(normalized.personaCodigo);
      const document = normalized.documento ? this.normalizeDocument(normalized.documento) : null;
      const email = normalized.email ? this.normalizeEmail(normalized.email) : null;
      const phone = normalized.telefono ? this.normalizeText(normalized.telefono) : null;
      const existingRef = refByCode.get(code);
      const existingDocumentRef = document ? refByDocument.get(document) : undefined;
      const existingMemberFromRef = existingRef ? memberById.get(existingRef.entityId) : undefined;
      const existingMemberFromEmail = email ? memberByEmail.get(email) : undefined;
      const existingMemberFromPhone = phone ? memberByPhone.get(phone) : undefined;
      const existingMemberFromDocument = document && existingDocumentRef ? memberById.get(existingDocumentRef.entityId) : undefined;
      const existingMember = existingMemberFromRef ?? existingMemberFromEmail ?? existingMemberFromPhone ?? existingMemberFromDocument;
      const existingUser = email ? userByEmail.get(email) : undefined;

      if (existingRef && !existingMember) {
        throw new ConflictException(`La persona ${code} referencia un miembro del tenant inexistente`);
      }

      const candidate = existingMember ?? undefined;
      if (candidate) {
        if (candidate.role !== Role.RESIDENT) {
          throw new ConflictException(`La persona ${code} está vinculada a un miembro que no es residente`);
        }

        if (document && existingDocumentRef && existingDocumentRef.entityId !== candidate.id) {
          throw new ConflictException(`La persona entra en conflicto con una identidad existente por document en el tenant`);
        }

        const sameName = this.normalizeText(candidate.name) === this.normalizeText(normalized.nombre);
        const sameIdentity = Boolean(
          (email && (
            (existingMemberFromEmail && this.normalizeEmail(existingMemberFromEmail.email ?? '') === email) ||
            (existingUser && this.normalizeEmail(existingUser.email) === email)
          )) ||
          (phone && existingMemberFromPhone && this.normalizeText(existingMemberFromPhone.phone ?? '') === phone) ||
          (document && existingDocumentRef && existingDocumentRef.entityId === candidate.id)
        );

        if (!sameName || !sameIdentity) {
          throw new ConflictException(`La persona entra en conflicto con una identidad existente por ${email ? 'email' : phone ? 'phone' : 'document'} en el tenant`);
        }

        const conflictingMember = this.findConflictingMember(existingMembers, candidate.id, email, phone);
        if (conflictingMember) {
          throw new ConflictException(`La persona ${code} entra en conflicto con otro miembro del tenant`);
        }

        const updated = await tx.tenantMember.update({
          where: { id: candidate.id },
          data: {
            name: normalized.nombre,
            email: email ?? undefined,
            phone: phone ?? undefined,
            role: Role.RESIDENT,
            status: MemberStatus.ACTIVE,
            userId: candidate.userId ?? existingUser?.id ?? undefined,
          },
        });

        memberMap.set(code, updated.id);
        summary.people.reused += 1;
        await this.upsertExternalReference(tx, input.tenantId, 'PERSON', code, updated.id);
        if (document) {
          await this.upsertExternalReference(tx, input.tenantId, 'PERSON_DOCUMENT', document, updated.id);
        }
        continue;
      }

      if (existingUser) {
        if (this.normalizeText(existingUser.name ?? '') !== this.normalizeText(normalized.nombre)) {
          throw new ConflictException(`La persona entra en conflicto con una identidad existente por email en el tenant`);
        }

        if (email && this.normalizeEmail(existingUser.email) !== email) {
          throw new ConflictException(`La persona entra en conflicto con una identidad existente por email en el tenant`);
        }
      }

      if (existingMemberFromEmail || existingMemberFromPhone || existingDocumentRef) {
        throw new ConflictException(`La persona entra en conflicto con una identidad existente por ${existingMemberFromEmail ? 'email' : existingMemberFromPhone ? 'phone' : 'document'} en el tenant`);
      }

      const created = await tx.tenantMember.create({
        data: {
          tenantId: input.tenantId,
          name: normalized.nombre,
          email: email ?? undefined,
          phone: phone ?? undefined,
          role: Role.RESIDENT,
          status: MemberStatus.ACTIVE,
          userId: existingUser?.id ?? null,
        },
      });

      memberMap.set(code, created.id);
      summary.people.created += 1;
      await this.upsertExternalReference(tx, input.tenantId, 'PERSON', code, created.id);
      if (document) {
        await this.upsertExternalReference(tx, input.tenantId, 'PERSON_DOCUMENT', document, created.id);
      }
    }

    return memberMap;
  }

  private async confirmRelations(
    tx: Prisma.TransactionClient,
    input: ConfirmImportInput,
    rows: ParsedWorkbookData['relations'],
    unitMap: Map<string, string>,
    memberMap: Map<string, string>,
    summary: WorkingConfirmationSummary,
  ): Promise<void> {
    const seen = new Set<string>();
    const principalByUnit = new Map<string, number>();
    const unitIds = Array.from(new Set(Array.from(unitMap.values())));
    const existingOccupants = await tx.unitOccupant.findMany({
      where: {
        tenantId: input.tenantId,
        unitId: { in: unitIds },
      },
      select: { unitId: true, memberId: true, role: true, isPrimary: true, startDate: true, endDate: true },
    });
    const existingByKey = new Map(existingOccupants.map((occupant) => [`${occupant.unitId}:${occupant.memberId}`, occupant] as const));

    for (const row of rows) {
      const normalized = this.requireNormalizedRow(row, 'Relations');
      const personCode = this.normalizeCode(normalized.personaCodigo);
      const buildingCode = this.normalizeCode(normalized.edificioCodigo);
      const unitCode = this.normalizeCode(normalized.unidadCodigo);
      const relationKey = `${personCode}:${buildingCode}:${unitCode}:${normalized.rol}:${normalized.principal ? '1' : '0'}`;
      const unitId = unitMap.get(`${buildingCode}::${unitCode}`);
      const memberId = memberMap.get(personCode);

      if (seen.has(relationKey)) {
        throw new ConflictException('Relación duplicada en el archivo');
      }
      seen.add(relationKey);

      if (!unitId || !memberId) {
        throw new ConflictException(`La relación ${relationKey} referencia entidades inexistentes`);
      }

      const principalCount = principalByUnit.get(unitId) ?? 0;
      if (normalized.principal && principalCount > 0) {
        throw new ConflictException(`La unidad ${unitCode} ya tiene un ocupante principal en el archivo`);
      }
      if (normalized.principal) {
        principalByUnit.set(unitId, principalCount + 1);
      }

      const existing = existingByKey.get(`${unitId}:${memberId}`);
      if (existing) {
        const sameRelation =
          existing.role === normalized.rol
          && existing.isPrimary === normalized.principal
          && this.sameCalendarDate(existing.startDate, normalized.startDate)
          && existing.endDate === null;

        if (!sameRelation) {
          throw new ConflictException(`La relación ${relationKey} entra en conflicto con un ocupante existente`);
        }

        summary.relations.reused += 1;
        continue;
      }

      const otherPrincipal = existingOccupants.find((occupant) => occupant.unitId === unitId && occupant.isPrimary && occupant.endDate === null);
      if (normalized.principal && otherPrincipal && otherPrincipal.memberId !== memberId) {
        throw new ConflictException(`La unidad ${unitCode} ya tiene un ocupante principal distinto`);
      }

      await tx.unitOccupant.create({
        data: {
          tenantId: input.tenantId,
          unitId,
          memberId,
          role: normalized.rol as UnitOccupantRole,
          isPrimary: normalized.principal,
          startDate: new Date(`${normalized.startDate}T00:00:00.000Z`),
        },
      });
      summary.relations.created += 1;
    }
  }

  private async confirmCharges(
    tx: Prisma.TransactionClient,
    input: ConfirmImportInput,
    rows: ParsedWorkbookData['openingBalances'],
    buildingMap: Map<string, string>,
    unitMap: Map<string, string>,
    summary: WorkingConfirmationSummary,
  ): Promise<void> {
    for (const row of rows) {
      const normalized = this.requireNormalizedRow(row, 'Opening balances');
      const buildingCode = this.normalizeCode(normalized.edificioCodigo);
      const unitCode = this.normalizeCode(normalized.unidadCodigo);
      const buildingId = buildingMap.get(buildingCode);
      const unitId = unitMap.get(`${buildingCode}::${unitCode}`);

      if (!buildingId || !unitId) {
        throw new ConflictException(`El saldo inicial ${buildingCode}:${unitCode} referencia entidades inexistentes`);
      }

      if (this.normalizeCode(normalized.currency) !== input.tenantCurrency) {
        throw new ConflictException(`La moneda del saldo inicial ${normalized.currency} no coincide con la moneda del tenant ${input.tenantCurrency}`);
      }

      const existing = await tx.charge.findFirst({
        where: {
          tenantId: input.tenantId,
          importJobId: input.importId,
          unitId,
          period: normalized.period,
          concept: normalized.concept,
        },
        select: { id: true, unitId: true, period: true, concept: true, amount: true, currency: true, type: true, dueDate: true, importJobId: true },
      });

      const amount = normalized.amountMinor;
      const type = normalized.kind === 'CREDITO' ? ChargeType.CREDIT : ChargeType.COMMON_EXPENSE;
      const dueDate = new Date(`${normalized.dueDate}T00:00:00.000Z`);

      if (existing) {
        const sameCharge =
          existing.amount === amount
          && existing.currency === normalized.currency
          && existing.type === type
          && existing.dueDate.toISOString().slice(0, 10) === normalized.dueDate;

        if (!sameCharge) {
          throw new ConflictException(`Charge ${normalized.concept} conflicts with the current database state`);
        }

        summary.charges.reused += 1;
        continue;
      }

      await tx.charge.create({
        data: {
          tenantId: input.tenantId,
          buildingId,
          unitId,
          period: normalized.period,
          type,
          concept: normalized.concept,
          amount,
          currency: normalized.currency,
          dueDate,
          status: ChargeStatus.PENDING,
          createdByMembershipId: input.membershipId ?? undefined,
          importJobId: input.importId,
        },
      });
      summary.charges.created += 1;
    }
  }

  private async loadNormalizedPayload(job: ImportJobConfirmationRecord): Promise<ConfirmNormalizedPayload> {
    if (!job.normalizedObjectKey) {
      throw new ConflictException('La importación no tiene payload normalizado disponible');
    }

    const buffer = await this.minio.getObjectBuffer(undefined, job.normalizedObjectKey);
    const payload = this.parseJson(buffer);

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new UnprocessableEntityException('El payload normalizado es inválido');
    }

    const record = payload as Record<string, unknown>;
    const data = record.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new UnprocessableEntityException('El payload normalizado no contiene datos válidos');
    }

    return {
      importId: this.requireString(record.importId, 'importId'),
      tenantId: this.requireString(record.tenantId, 'tenantId'),
      type: this.requireString(record.type, 'type'),
      schemaVersion: this.requireString(record.schemaVersion, 'schemaVersion'),
      fileHash: this.requireString(record.fileHash, 'fileHash'),
      fileName: this.requireString(record.fileName, 'fileName'),
      summary: this.coerceSummary(record.summary),
      issues: Array.isArray(record.issues) ? (record.issues as ImportIssueRecord[]) : [],
      data: this.assertWorkbookData(data),
    };
  }

  private assertConfirmableState(job: ImportJobConfirmationRecord): void {
    if (job.status === ImportJobStatus.READY && job.expiresAt < new Date()) {
      throw new ConflictException('La importación expiró y debe regenerarse');
    }

    if (job.status !== ImportJobStatus.READY && job.status !== ImportJobStatus.CONFIRMING) {
      throw new ConflictException(`La importación no puede confirmarse desde el estado ${job.status}`);
    }
  }

  private assertPayloadIntegrity(job: ImportJobConfirmationRecord, payload: ConfirmNormalizedPayload): void {
    if (payload.importId !== job.id || payload.tenantId !== job.tenantId) {
      throw new ConflictException('El payload normalizado no pertenece a la importación solicitada');
    }

    if (payload.type !== 'INITIAL_ONBOARDING') {
      throw new ConflictException('El payload normalizado tiene un tipo inválido');
    }

    if (payload.schemaVersion !== ONBOARDING_IMPORT_SCHEMA_VERSION) {
      throw new ConflictException('La versión del payload no coincide con la importación solicitada');
    }

    if (payload.fileHash !== job.fileHash) {
      throw new ConflictException('El hash del payload no coincide con la importación solicitada');
    }

    const payloadHash = this.computeHash(Buffer.from(JSON.stringify(payload), 'utf8'));
    if (job.previewHash && payloadHash !== job.previewHash) {
      throw new ConflictException('El payload normalizado fue alterado o ya no coincide con la vista previa');
    }
  }

  private async acquireConfirmationLock(job: ImportJobConfirmationRecord, membershipId: string | null): Promise<boolean> {
    const now = new Date();
    const lockExpiresAt = new Date(now.getTime() + ONBOARDING_IMPORT_CONFIRM_LOCK_TIMEOUT_MS);

    const result = await this.prisma.importJob.updateMany({
      where: {
        id: job.id,
        tenantId: job.tenantId,
        status: ImportJobStatus.READY,
        canConfirm: true,
        confirmedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        status: ImportJobStatus.CONFIRMING,
        confirmingAt: now,
        confirmingLockExpiresAt: lockExpiresAt,
        confirmingByMembershipId: membershipId,
      },
    });

    if (result.count > 0) {
      return true;
    }

    const current = await this.prisma.importJob.findFirst({
      where: { id: job.id, tenantId: job.tenantId },
      include: { issues: { select: { id: true } } },
    });

    if (!current) {
      throw new NotFoundException('Importación no encontrada');
    }

    if (current.status === ImportJobStatus.CONFIRMED) {
      return false;
    }

    if (current.status === ImportJobStatus.CONFIRMING && current.confirmingLockExpiresAt && current.confirmingLockExpiresAt <= now) {
      const takeover = await this.prisma.importJob.updateMany({
        where: {
          id: job.id,
          tenantId: job.tenantId,
          status: ImportJobStatus.CONFIRMING,
          confirmingLockExpiresAt: { lte: now },
        },
        data: {
          confirmingAt: now,
          confirmingLockExpiresAt: lockExpiresAt,
          confirmingByMembershipId: membershipId,
        },
      });

      return takeover.count > 0;
    }

    return false;
  }

  private async markConfirmationFailed(
    importId: string,
    tenantId: string,
    membershipId: string | null,
    error: unknown,
  ): Promise<void> {
    const errorCode = this.sanitizeErrorCode(error);
    const errorMessage = this.sanitizeErrorMessage(error);

    try {
      await this.prisma.importJob.updateMany({
        where: { id: importId, tenantId },
        data: {
          status: ImportJobStatus.FAILED,
          errorCode,
          errorMessage,
          confirmingAt: null,
          confirmingLockExpiresAt: null,
          confirmingByMembershipId: null,
          canConfirm: false,
        },
      });
    } catch {
      // best effort
    }

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId ?? undefined,
      action: AuditAction.IMPORT_CONFIRM_FAILED,
      entityType: 'ImportJob',
      entityId: importId,
      metadata: {
        errorCode,
        errorMessage,
      },
    });
  }

  private mapConfirmationResponse(job: ImportJobConfirmationRecord): ConfirmOnboardingImportResult {
    const stored = this.extractConfirmationResult(job);
    return {
      importId: job.id,
      status: 'CONFIRMED',
      confirmedAt: stored.confirmedAt,
      summary: stored.summary,
    };
  }

  private extractConfirmationResult(job: ImportJobConfirmationRecord): ConfirmationResultPayload {
    const stored = job.confirmationResult as Record<string, unknown> | null;
    if (
      stored
      && typeof stored === 'object'
      && !Array.isArray(stored)
      && typeof stored.confirmedAt === 'string'
      && stored.summary
      && typeof stored.summary === 'object'
      && !Array.isArray(stored.summary)
      ) {
      return {
        importId: job.id,
        status: 'CONFIRMED',
        confirmedAt: stored.confirmedAt,
        summary: this.coerceConfirmationSummary(stored.summary as Record<string, unknown>),
      };
    }

    if (job.confirmationSummary && typeof job.confirmationSummary === 'object' && !Array.isArray(job.confirmationSummary)) {
      return {
        importId: job.id,
        status: 'CONFIRMED',
        confirmedAt: job.confirmedAt?.toISOString() ?? new Date().toISOString(),
        summary: this.coerceConfirmationSummary(job.confirmationSummary as Record<string, unknown>),
      };
    }

    return {
      importId: job.id,
      status: 'CONFIRMED',
      confirmedAt: job.confirmedAt?.toISOString() ?? new Date().toISOString(),
      summary: {
        buildingsCreated: 0,
        buildingsReused: 0,
        unitCategoriesCreated: 0,
        unitCategoriesReused: 0,
        unitsCreated: 0,
        unitsReused: 0,
        peopleCreated: 0,
        peopleReused: 0,
        relationsCreated: 0,
        relationsReused: 0,
        chargesCreated: 0,
        chargesReused: 0,
      },
    };
  }

  private extractConfirmationSummary(job: ImportJobConfirmationRecord): ConfirmOnboardingImportSummary {
    return this.extractConfirmationResult(job).summary;
  }

  private coerceConfirmationSummary(value: Record<string, unknown>): ConfirmOnboardingImportSummary {
    return {
      buildingsCreated: this.coerceNumber(value.buildingsCreated),
      buildingsReused: this.coerceNumber(value.buildingsReused),
      unitCategoriesCreated: this.coerceNumber(value.unitCategoriesCreated),
      unitCategoriesReused: this.coerceNumber(value.unitCategoriesReused),
      unitsCreated: this.coerceNumber(value.unitsCreated),
      unitsReused: this.coerceNumber(value.unitsReused),
      peopleCreated: this.coerceNumber(value.peopleCreated),
      peopleReused: this.coerceNumber(value.peopleReused),
      relationsCreated: this.coerceNumber(value.relationsCreated),
      relationsReused: this.coerceNumber(value.relationsReused),
      chargesCreated: this.coerceNumber(value.chargesCreated),
      chargesReused: this.coerceNumber(value.chargesReused),
    };
  }

  private createWorkingSummary(): WorkingConfirmationSummary {
    return {
      buildings: { created: 0, reused: 0 },
      unitCategories: { created: 0, reused: 0 },
      units: { created: 0, reused: 0 },
      people: { created: 0, reused: 0 },
      relations: { created: 0, reused: 0 },
      charges: { created: 0, reused: 0 },
      buildingsCreated: 0,
      buildingsReused: 0,
      unitCategoriesCreated: 0,
      unitCategoriesReused: 0,
      unitsCreated: 0,
      unitsReused: 0,
      peopleCreated: 0,
      peopleReused: 0,
      relationsCreated: 0,
      relationsReused: 0,
      chargesCreated: 0,
      chargesReused: 0,
    };
  }

  private stripWorkingSummary(summary: WorkingConfirmationSummary): ConfirmOnboardingImportSummary {
    return {
      buildingsCreated: summary.buildings.created,
      buildingsReused: summary.buildings.reused,
      unitCategoriesCreated: summary.unitCategories.created,
      unitCategoriesReused: summary.unitCategories.reused,
      unitsCreated: summary.units.created,
      unitsReused: summary.units.reused,
      peopleCreated: summary.people.created,
      peopleReused: summary.people.reused,
      relationsCreated: summary.relations.created,
      relationsReused: summary.relations.reused,
      chargesCreated: summary.charges.created,
      chargesReused: summary.charges.reused,
    };
  }

  private assertWorkbookData(value: object): ParsedWorkbookData {
    const record = value as Record<string, unknown>;
    return {
      buildings: this.assertBuildingRows(record.buildings),
      units: this.assertUnitRows(record.units),
      people: this.assertPersonRows(record.people),
      relations: this.assertRelationRows(record.relations),
      openingBalances: this.assertOpeningBalanceRows(record.openingBalances),
    };
  }

  private assertBuildingRows(value: unknown): ParsedWorkbookData['buildings'] {
    return this.assertParsedRows<ParsedBuildingRowRaw, ParsedBuildingRowNormalized>(value, 'Buildings');
  }

  private assertUnitRows(value: unknown): ParsedWorkbookData['units'] {
    return this.assertParsedRows<ParsedUnitRowRaw, ParsedUnitRowNormalized>(value, 'Units');
  }

  private assertPersonRows(value: unknown): ParsedWorkbookData['people'] {
    return this.assertParsedRows<ParsedPersonRowRaw, ParsedPersonRowNormalized>(value, 'People');
  }

  private assertRelationRows(value: unknown): ParsedWorkbookData['relations'] {
    return this.assertParsedRows<ParsedUnitRelationRowRaw, ParsedUnitRelationRowNormalized>(value, 'Relations');
  }

  private assertOpeningBalanceRows(value: unknown): ParsedWorkbookData['openingBalances'] {
    return this.assertParsedRows<
      ParsedOpeningBalanceRowRaw,
      {
        readonly edificioCodigo: string;
        readonly unidadCodigo: string;
        readonly period: string;
        readonly concept: string;
        readonly amountMinor: number;
        readonly currency: string;
        readonly dueDate: string;
        readonly kind: 'DEBITO' | 'CREDITO';
      }
    >(value, 'Opening balances');
  }

  private assertParsedRows<TRaw extends object, TNormalized extends object>(
    value: unknown,
    label: string,
  ): Array<ParsedRow<TRaw, TNormalized>> {
    if (!Array.isArray(value)) {
      throw new UnprocessableEntityException(`El payload de ${label} no es válido`);
    }

    return value.map((row, index) => this.assertParsedRow<TRaw, TNormalized>(row, label, index));
  }

  private assertParsedRow<TRaw extends object, TNormalized extends object>(
    value: unknown,
    label: string,
    index: number,
  ): ParsedRow<TRaw, TNormalized> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new UnprocessableEntityException(`La fila ${index} de ${label} no es válida`);
    }

    const record = value as Record<string, unknown>;
    if (typeof record.sheet !== 'string' || !record.sheet.trim()) {
      throw new UnprocessableEntityException(`La fila ${index} de ${label} tiene una hoja inválida`);
    }

    const rowNumber = this.requireInteger(record.rowNumber, 'rowNumber');

    if (!record.raw || typeof record.raw !== 'object' || Array.isArray(record.raw)) {
      throw new UnprocessableEntityException(`La fila ${index} de ${label} tiene un payload bruto inválido`);
    }

    if (!record.normalized || typeof record.normalized !== 'object' || Array.isArray(record.normalized)) {
      throw new UnprocessableEntityException(`La fila ${index} de ${label} tiene un payload normalizado inválido`);
    }

    return {
      sheet: record.sheet as ImportSheetName,
      rowNumber,
      raw: record.raw as TRaw,
      normalized: record.normalized as TNormalized,
    };
  }

  private async upsertExternalReference(
    tx: Prisma.TransactionClient,
    tenantId: string,
    entityType: string,
    externalCode: string,
    entityId: string,
  ): Promise<void> {
    await tx.externalEntityReference.upsert({
      where: {
        tenantId_source_entityType_externalCode: {
          tenantId,
          source: 'onboarding-import',
          entityType,
          externalCode,
        },
      },
      update: { entityId },
      create: {
        tenantId,
        source: 'onboarding-import',
        entityType,
        externalCode,
        entityId,
      },
    });
  }

  private async assertNoCategoryOverlap(
    tx: Prisma.TransactionClient,
    tenantId: string,
    buildingId: string,
    minM2: number,
    maxM2: number,
    categoryName: string,
  ): Promise<void> {
    const existing = await tx.unitCategory.findMany({
      where: { tenantId, buildingId },
      select: { name: true, minM2: true, maxM2: true },
    });

    for (const category of existing) {
      const existingMax = category.maxM2 ?? Number.POSITIVE_INFINITY;
      if (this.rangesOverlap(minM2, maxM2, category.minM2, existingMax)) {
        throw new ConflictException(`La categoría de unidad ${categoryName} se superpone con la categoría existente ${category.name}`);
      }
    }
  }

  private rangesOverlap(minA: number, maxA: number, minB: number, maxB: number): boolean {
    return minA <= maxB && minB <= maxA;
  }

  private isRangeCompatible(existingMin: number, existingMax: number | null, min: number, max: number): boolean {
    return min >= existingMin && max <= (existingMax ?? Number.POSITIVE_INFINITY);
  }

  private findConflictingMember(
    members: TenantMemberRecord[],
    candidateId: string,
    email: string | null,
    phone: string | null,
  ): TenantMemberRecord | undefined {
    return members.find((member) => {
      if (member.id === candidateId) {
        return false;
      }

      if (email && member.email && this.normalizeEmail(member.email) === email) {
        return true;
      }

      if (phone && member.phone && this.normalizeText(member.phone) === phone) {
        return true;
      }

      return false;
    });
  }

  private resolveCategoryName(row: ParsedUnitRowNormalized): string {
    if (row.categoriaNombre) {
      return this.normalizeText(row.categoriaNombre);
    }

    if (row.coeficiente !== null && row.coeficiente !== undefined) {
      return `COEF_${row.coeficiente}`;
    }

      throw new BadRequestException('El nombre de la categoría de unidad o el coeficiente son obligatorios');
  }

  private compareNullableNumbers(left: number | null, right: number | null): boolean {
    if (left === null && right === null) {
      return true;
    }

    if (left === null || right === null) {
      return false;
    }

    return Math.abs(left - right) < 0.0001;
  }

  private resolveLegacyOccupancyStatus(row: ParsedUnitRowNormalized): 'VACANT' | 'OCCUPIED' {
    if (row.estadoOcupacion) {
      return row.estadoOcupacion;
    }

    return row.facturacion ? 'OCCUPIED' : 'VACANT';
  }

  private compareNumbers(left: number, right: number): boolean {
    return Math.abs(left - right) < 0.0001;
  }

  private sameCalendarDate(left: Date, rightIsoDate: string): boolean {
    return left.toISOString().slice(0, 10) === rightIsoDate.slice(0, 10);
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

  private requireNormalizedRow<TRaw extends object, TNormalized extends object>(
    row: ParsedRow<TRaw, TNormalized>,
    label: string,
  ): TNormalized {
    if (!row.normalized) {
      throw new UnprocessableEntityException(`La fila ${row.rowNumber} de ${label} no tiene datos normalizados`);
    }

    return row.normalized;
  }

  private optionalString(value: unknown): string | null {
    const normalized = this.normalizer.normalizeText(value);
    return normalized;
  }

  private optionalNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new UnprocessableEntityException(`${field} es obligatorio`);
    }

    return value.trim();
  }

  private requireInteger(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      throw new UnprocessableEntityException(`${field} es obligatorio`);
    }

    return value;
  }

  private coerceSummary(value: unknown): ImportPreviewSummary {
    const empty = {
      buildings: { total: 0, new: 0, reusable: 0, conflict: 0, invalid: 0 },
      units: { total: 0, new: 0, reusable: 0, conflict: 0, invalid: 0 },
      people: { total: 0, new: 0, reusable: 0, conflict: 0, invalid: 0 },
      relations: { total: 0, new: 0, reusable: 0, conflict: 0, invalid: 0 },
      openingBalances: { total: 0, new: 0, reusable: 0, conflict: 0, invalid: 0 },
      blockingIssues: 0,
      warnings: 0,
    } satisfies ImportPreviewSummary;

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return empty;
    }

    const record = value as Record<string, unknown>;
    return {
      buildings: this.coerceStats(record.buildings),
      units: this.coerceStats(record.units),
      people: this.coerceStats(record.people),
      relations: this.coerceStats(record.relations),
      openingBalances: this.coerceStats(record.openingBalances),
      blockingIssues: this.coerceNumber(record.blockingIssues),
      warnings: this.coerceNumber(record.warnings),
    };
  }

  private coerceStats(value: unknown): ImportPreviewSummary['buildings'] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { total: 0, new: 0, reusable: 0, conflict: 0, invalid: 0 };
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

  private coerceNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private parseJson(buffer: Buffer): unknown {
    try {
      return JSON.parse(buffer.toString('utf8')) as unknown;
    } catch {
      throw new UnprocessableEntityException('El payload normalizado no es JSON válido');
    }
  }

  private computeHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  private isSerializationConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
  }

  private isKnownImportP2002(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }

    return this.isKnownImportUniqueTarget(this.getUniqueTarget(error));
  }

  private isKnownImportUniqueTarget(target: string[]): boolean {
    return (
      this.matchesUniqueTarget(target, ['tenantId', 'email']) ||
      this.matchesUniqueTarget(target, ['tenantId', 'phone']) ||
      this.matchesUniqueTarget(target, ['tenantId', 'source', 'entityType', 'externalCode']) ||
      this.matchesUniqueTarget(target, ['tenantId', 'unitId', 'memberId']) ||
      this.matchesUniqueTarget(target, ['tenantId', 'importJobId', 'unitId', 'period', 'concept'])
    );
  }

  private matchesUniqueTarget(target: string[], expectedFields: string[]): boolean {
    if (target.length !== expectedFields.length) {
      return false;
    }

    const normalizedTarget = [...target].sort().join('|');
    const normalizedExpected = [...expectedFields].sort().join('|');
    return normalizedTarget === normalizedExpected;
  }

  private getUniqueTarget(error: Prisma.PrismaClientKnownRequestError): string[] {
    const meta = error.meta as { target?: unknown } | undefined;
    if (!Array.isArray(meta?.target)) {
      return [];
    }

    return meta.target.filter((value): value is string => typeof value === 'string');
  }

  private sanitizeErrorMessage(error: unknown): string {
    if (this.isKnownImportP2002(error)) {
      return 'Se detectó un conflicto de identidad durante la confirmación';
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return 'Error de base de datos durante la confirmación';
    }

    if (error instanceof Error) {
      return error.message.slice(0, 200);
    }

    return String(error).slice(0, 200);
  }

  private sanitizeErrorCode(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error) {
      return String((error as { code?: unknown }).code ?? 'IMPORT_ERROR').slice(0, 80);
    }

    return 'IMPORT_ERROR';
  }

  private normalizeDocument(value: string): string {
    return this.normalizeText(value).toUpperCase();
  }

  private rethrow(error: unknown): never {
    if (this.isKnownImportP2002(error)) {
      throw new ConflictException('Se detectó un conflicto de identidad durante la confirmación');
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new Error('Error de base de datos durante la confirmación');
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(this.sanitizeErrorMessage(error));
  }
}
