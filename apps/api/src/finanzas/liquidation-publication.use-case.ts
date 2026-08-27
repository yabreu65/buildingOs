import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ChargeStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { FinanzasValidators } from './finanzas.validators';
import {
  assertLiquidationMovementCurrency,
  buildLiquidationPublicationSnapshot,
  buildLiquidationPublicationSnapshotV3,
  type PublishedExpenseSnapshot,
  type PublishedIncomeOffsetSnapshot,
} from './liquidation-publication-snapshot';
import {
  type LiquidationResponseDto,
  type PublishLiquidationDto,
} from './expense-ledger.dto';
import { lockUnitChargesForAllocation } from './payment-allocation-transaction';
import { lockUnitsFinancialMutations } from './unit-financial-lock';

export type NotificationPolicy = 'post-commit' | 'disabled';

interface FinanceMembershipRecord {
  id: string;
  tenantId: string;
  userId: string;
  roles: Array<{
    role: string;
    scopeType: 'TENANT' | 'BUILDING' | 'UNIT';
  }>;
}

export interface FinanceMembershipContext {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly roles: string[];
}

interface FinanceMembershipClient {
  membership: {
    findFirst: (args: {
      where: { id: string; tenantId: string };
      select: {
        id: boolean;
        tenantId: boolean;
        userId: boolean;
        roles: { select: { role: boolean; scopeType: boolean } };
      };
    }) => Promise<FinanceMembershipRecord | null>;
  };
}

export interface LiquidationExpenseSnapshotItem extends Prisma.InputJsonObject {
  expenseId: string;
  categoryName: string;
  vendorName: string | null;
  amountMinor: number;
  currencyCode: string;
  invoiceDate: string;
  description: string | null;
  type: 'EXPENSE' | 'ADJUSTMENT';
  sourcePeriod?: string;
}

export interface NotificationDispatchResult {
  readonly sentCount: number;
  readonly failedCount: number;
  readonly errorMessages: ReadonlyArray<string>;
}

interface AuditWriteClient {
  auditLog: {
    create: (args: { data: Prisma.AuditLogUncheckedCreateInput }) => Promise<unknown>;
  };
}

interface NotificationServicePort {
  createNotification: NotificationsService['createNotification'];
}

export interface LiquidationWorkflowPrismaClient extends FinanceMembershipClient {
  $transaction: <T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ) => Promise<T>;
  liquidation: {
    findFirst: (args: Prisma.LiquidationFindFirstArgs) => Promise<Prisma.LiquidationGetPayload<Prisma.LiquidationFindFirstArgs> | null>;
    create: (args: Prisma.LiquidationCreateArgs) => Promise<Prisma.LiquidationGetPayload<Prisma.LiquidationCreateArgs>>;
  };
}

export interface LiquidationWorkflowDependencies {
  readonly prisma: LiquidationWorkflowPrismaClient;
  readonly isAdminOrOperator: (roles: string[]) => boolean;
  readonly createAuditLogRequired: (
    input: {
      tenantId: string;
      actorMembershipId?: string;
      action: 'LIQUIDATION_DRAFT' | 'LIQUIDATION_REVIEW' | 'LIQUIDATION_PUBLISH';
      entityType: 'Liquidation';
      entityId: string;
      metadata?: Record<string, unknown>;
    },
    tx: AuditWriteClient,
  ) => Promise<void>;
  readonly createAuditLog: (
    input: {
      tenantId?: string;
      action: 'LIQUIDATION_PUBLISH';
      entityType: 'Liquidation';
      entityId: string;
      metadata?: Record<string, unknown>;
    },
  ) => Promise<void>;
  readonly toPublishedLiquidationDto: (
    liquidation: LiquidationRecord,
  ) => LiquidationResponseDto;
  readonly sendChargePublishedNotifications: (
    tenantId: string,
    liquidationId: string,
    liquidation: {
      period: string;
      buildingId: string;
      baseCurrency: string;
    },
    excludeUserId?: string,
  ) => Promise<NotificationDispatchResult>;
}

type LiquidationRecord = {
  id: string;
  tenantId: string;
  buildingId: string;
  period: string;
  chargePeriod: string | null;
  status: 'DRAFT' | 'REVIEWED' | 'PUBLISHED' | 'CANCELED';
  valuationMode: 'FUNCTIONAL' | 'LEGACY_NOMINAL' | null;
  baseCurrency: string;
  totalAmountMinor: number;
  totalsByCurrency: unknown;
  expenseSnapshot: unknown;
  publicationSnapshot: unknown;
  unitCount: number;
  generatedAt: Date;
  reviewedAt: Date | null;
  publishedAt: Date | null;
  canceledAt: Date | null;
  createdAt: Date;
  grossExpenseAmountMinor: number | null;
  adjustmentAmountMinor: number | null;
  preIncomeAmountMinor: number | null;
  incomeOffsetAmountMinor: number | null;
  netDistributableAmountMinor: number | null;
  incomeOffsetSnapshot: unknown;
  incomeOffsetsByCurrency: unknown;
};

type LiquidationResponseRecord = Omit<
  LiquidationRecord,
  'expenseSnapshot' | 'publicationSnapshot' | 'incomeOffsetSnapshot' | 'incomeOffsetsByCurrency'
>;

export interface DraftLiquidationInput {
  readonly tenantId: string;
  readonly buildingId: string;
  readonly period: string;
  readonly chargePeriod?: string | null;
  readonly valuationMode?: 'FUNCTIONAL' | 'LEGACY_NOMINAL' | null;
  readonly baseCurrency: string;
  readonly totalAmountMinor: number;
  readonly totalsByCurrency: Prisma.InputJsonObject;
  readonly expenseSnapshot: Prisma.InputJsonArray;
  readonly unitCount: number;
  readonly generatedByMembershipId: string;
  // FIN-06: desglose del neto distributable (opcional = legacy pre-FIN-06)
  readonly grossExpenseAmountMinor?: number;
  readonly adjustmentAmountMinor?: number;
  readonly preIncomeAmountMinor?: number;
  readonly incomeOffsetAmountMinor?: number;
  readonly netDistributableAmountMinor?: number;
  readonly incomeOffsetSnapshot?: Prisma.InputJsonArray;
  readonly incomeOffsetsByCurrency?: Prisma.InputJsonObject;
  readonly createIncomeOffsetReferences?: ReadonlyArray<{
    incomeApplicationId: string;
    buildingId: string;
    originalAmountMinor: number;
    currencyCode: string;
    valuedAmountMinor: number;
    baseCurrency: string;
  }>;
}

export async function requireFinanceMembership(
  client: FinanceMembershipClient,
  tenantId: string,
  membershipId: string,
  isAdminOrOperator: (roles: string[]) => boolean,
): Promise<FinanceMembershipContext> {
  const membership = await client.membership.findFirst({
    where: { id: membershipId, tenantId },
    select: {
      id: true,
      tenantId: true,
      userId: true,
      roles: { select: { role: true, scopeType: true } },
    },
  });

  if (!membership) {
    throw new ForbiddenException('No se encontró una membresía válida para el tenant');
  }

  const tenantRoles = membership.roles
    .filter((role) => role.scopeType === 'TENANT')
    .map((role) => role.role);

  if (!isAdminOrOperator(tenantRoles)) {
    throw new ForbiddenException('Solo administradores pueden gestionar liquidaciones');
  }

  return {
    id: membership.id,
    tenantId: membership.tenantId,
    userId: membership.userId,
    roles: tenantRoles,
  };
}

export function toLiquidationResponseDto(
  liquidation: LiquidationResponseRecord,
): LiquidationResponseDto {
  return {
    id: liquidation.id,
    tenantId: liquidation.tenantId,
    buildingId: liquidation.buildingId,
    period: liquidation.period,
    chargePeriod: liquidation.chargePeriod,
    status: liquidation.status,
    valuationMode: liquidation.valuationMode,
    baseCurrency: liquidation.baseCurrency,
    totalAmountMinor: liquidation.totalAmountMinor,
    totalsByCurrency: parseTotalsByCurrency(liquidation.totalsByCurrency),
    unitCount: liquidation.unitCount,
    generatedAt: liquidation.generatedAt,
    reviewedAt: liquidation.reviewedAt,
    publishedAt: liquidation.publishedAt,
    canceledAt: liquidation.canceledAt,
    createdAt: liquidation.createdAt,
    grossExpenseAmountMinor: liquidation.grossExpenseAmountMinor ?? null,
    adjustmentAmountMinor: liquidation.adjustmentAmountMinor ?? null,
    preIncomeAmountMinor: liquidation.preIncomeAmountMinor ?? null,
    incomeOffsetAmountMinor: liquidation.incomeOffsetAmountMinor ?? null,
    netDistributableAmountMinor: liquidation.netDistributableAmountMinor ?? null,
  };
}

export async function sendChargePublishedNotifications(
  prisma: Pick<PrismaService, 'charge' | 'unit'>,
  notificationsService: NotificationServicePort,
  tenantId: string,
  liquidationId: string,
  liquidation: {
    period: string;
    buildingId: string;
    baseCurrency: string;
  },
  excludeUserId?: string,
): Promise<NotificationDispatchResult> {
  const logger = new Logger(LiquidationPublicationUseCase.name);
  let sentCount = 0;
  let failedCount = 0;
  const errorMessages: string[] = [];

  const charges = await prisma.charge.findMany({
    where: { tenantId, liquidationId },
  });

  for (const charge of charges) {
    const unit = await prisma.unit.findFirst({
      where: {
        tenantId,
        buildingId: liquidation.buildingId,
        id: charge.unitId,
      },
      include: {
        unitOccupants: {
          where: { tenantId, endDate: null },
          include: {
            member: {
              select: { id: true, tenantId: true, user: { select: { id: true } } },
            },
          },
        },
      },
    });

    if (!unit) {
      continue;
    }

    for (const occupant of unit.unitOccupants) {
      if (!occupant.member?.user?.id || occupant.member.user.id === excludeUserId) {
        continue;
      }

      const dueDateStr = charge.dueDate
        ? new Date(charge.dueDate).toLocaleDateString('es-AR')
        : 'N/A';

      try {
        await notificationsService.createNotification({
          tenantId,
          userId: occupant.member.user.id,
          type: 'CHARGE_PUBLISHED',
          title: `${liquidation.buildingId} - Nuevo cargo por ${liquidation.period}`,
          body: `Se ha registrado un cargo de ${(charge.amount / 100).toFixed(2)} ${liquidation.baseCurrency} en la unidad ${unit.label}. Vencimiento: ${dueDateStr}`,
          data: {
            chargeId: charge.id,
            unitLabel: unit.label,
            amountMinor: charge.amount,
            currency: liquidation.baseCurrency,
            period: liquidation.period,
            dueDate: charge.dueDate?.toISOString() ?? null,
            liquidationId,
          },
        });
        sentCount += 1;
      } catch (error) {
        failedCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        errorMessages.push(
          `charge=${charge.id} user=${occupant.member.user.id} message=${message}`,
        );
        logger.error(
          `Failed to create notification for charge ${charge.id} in liquidation ${liquidationId}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
  }

  return {
    sentCount,
    failedCount,
    errorMessages,
  };
}

export function createLiquidationWorkflowDependencies(params: {
  prisma: PrismaService;
  auditService: AuditService;
  validators: FinanzasValidators;
  notificationsService: NotificationServicePort;
}): LiquidationWorkflowDependencies {
  return {
    prisma: params.prisma,
    isAdminOrOperator: (roles) => params.validators.isAdminOrOperator(roles),
    createAuditLogRequired: (input, tx) => params.auditService.createLogRequired(input, tx),
    createAuditLog: (input) => params.auditService.createLog(input),
    toPublishedLiquidationDto: (liquidation) => toLiquidationResponseDto(liquidation),
    sendChargePublishedNotifications: (tenantId, liquidationId, liquidation, excludeUserId) =>
      sendChargePublishedNotifications(
        params.prisma,
        params.notificationsService,
        tenantId,
        liquidationId,
        liquidation,
        excludeUserId,
      ),
  };
}

export async function createLiquidationDraftRecord(
  tx: Prisma.TransactionClient,
  deps: Pick<LiquidationWorkflowDependencies, 'createAuditLogRequired'>,
  input: DraftLiquidationInput,
): Promise<LiquidationRecord> {
  const isFin06Input =
    input.grossExpenseAmountMinor !== undefined ||
    input.adjustmentAmountMinor !== undefined ||
    input.preIncomeAmountMinor !== undefined ||
    input.incomeOffsetAmountMinor !== undefined ||
    input.netDistributableAmountMinor !== undefined;

  const liquidation = await tx.liquidation.create({
    data: {
      tenantId: input.tenantId,
      buildingId: input.buildingId,
      period: input.period,
      chargePeriod: input.chargePeriod ?? null,
      valuationMode: input.valuationMode ?? null,
      baseCurrency: input.baseCurrency,
      totalAmountMinor: input.totalAmountMinor,
      totalsByCurrency: input.totalsByCurrency,
      expenseSnapshot: input.expenseSnapshot,
      unitCount: input.unitCount,
      generatedByMembershipId: input.generatedByMembershipId,
      grossExpenseAmountMinor: input.grossExpenseAmountMinor ?? null,
      adjustmentAmountMinor: input.adjustmentAmountMinor ?? null,
      preIncomeAmountMinor: input.preIncomeAmountMinor ?? null,
      incomeOffsetAmountMinor: input.incomeOffsetAmountMinor ?? null,
      netDistributableAmountMinor: input.netDistributableAmountMinor ?? null,
      // FIN-06R2: los drafts del motor FIN-06 persisten SIEMPRE los JSON,
      // incluso vacíos ([] / {}), para clasificarse como FIN-06 en publish.
      // Solo liquidaciones históricas pre-FIN-06 mantienen null.
      ...(isFin06Input
        ? {
            incomeOffsetSnapshot: (input.incomeOffsetSnapshot ??
              []) as Prisma.InputJsonArray,
            incomeOffsetsByCurrency: (input.incomeOffsetsByCurrency ??
              {}) as Prisma.InputJsonObject,
          }
        : {}),
    },
  });

  // FIN-06: referencias relacionales de las aplicaciones OFFSET usadas
  // (void-safety + provenance; una por liquidación/aplicación).
  // Sin skipDuplicates: una referencia duplicada es un bug financiero y debe
  // hacer rollback (el unique de la DB es la última barrera).
  if (input.createIncomeOffsetReferences && input.createIncomeOffsetReferences.length > 0) {
    await tx.liquidationIncomeOffset.createMany({
      data: input.createIncomeOffsetReferences.map((reference) => ({
        tenantId: input.tenantId,
        liquidationId: liquidation.id,
        incomeApplicationId: reference.incomeApplicationId,
        buildingId: reference.buildingId,
        originalAmountMinor: reference.originalAmountMinor,
        currencyCode: reference.currencyCode,
        valuedAmountMinor: reference.valuedAmountMinor,
        baseCurrency: reference.baseCurrency,
      })),
    });
  }

  await deps.createAuditLogRequired(
    {
      tenantId: input.tenantId,
      actorMembershipId: input.generatedByMembershipId,
      action: 'LIQUIDATION_DRAFT',
      entityType: 'Liquidation',
      entityId: liquidation.id,
      metadata: {
        period: input.period,
        buildingId: input.buildingId,
        totalAmountMinor: input.totalAmountMinor,
        baseCurrency: input.baseCurrency,
        expenseCount: input.expenseSnapshot.length,
        ...(input.grossExpenseAmountMinor !== undefined
          ? { grossExpenseAmountMinor: input.grossExpenseAmountMinor }
          : {}),
        ...(input.adjustmentAmountMinor !== undefined
          ? { adjustmentAmountMinor: input.adjustmentAmountMinor }
          : {}),
        ...(input.preIncomeAmountMinor !== undefined
          ? { preIncomeAmountMinor: input.preIncomeAmountMinor }
          : {}),
        ...(input.incomeOffsetAmountMinor !== undefined
          ? { incomeOffsetAmountMinor: input.incomeOffsetAmountMinor }
          : {}),
        ...(input.netDistributableAmountMinor !== undefined
          ? { netDistributableAmountMinor: input.netDistributableAmountMinor }
          : {}),
        ...(input.incomeOffsetSnapshot !== undefined
          ? { incomeOffsetCount: input.incomeOffsetSnapshot.length }
          : {}),
      },
    },
    tx,
  );

  const created = await tx.liquidation.findFirst({
    where: { id: liquidation.id, tenantId: input.tenantId },
  });

  if (!created) {
    throw new NotFoundException(`Liquidación no encontrada: ${liquidation.id}`);
  }

  return created as LiquidationRecord;
}

export async function reviewLiquidationRecord(
  tx: Prisma.TransactionClient,
  deps: Pick<LiquidationWorkflowDependencies, 'createAuditLogRequired'>,
  input: {
    readonly tenantId: string;
    readonly liquidationId: string;
    readonly membershipId: string;
  },
): Promise<LiquidationRecord> {
  const current = await tx.liquidation.findFirst({
    where: { id: input.liquidationId, tenantId: input.tenantId },
  });

  if (!current) {
    throw new NotFoundException(`Liquidación no encontrada: ${input.liquidationId}`);
  }

  const now = new Date();
  const updateResult = await tx.liquidation.updateMany({
    where: { id: input.liquidationId, tenantId: input.tenantId, status: 'DRAFT' },
    data: {
      status: 'REVIEWED',
      reviewedByMembershipId: input.membershipId,
      reviewedAt: now,
      updatedAt: now,
    },
  });

  if (updateResult.count !== 1) {
    const latest = await tx.liquidation.findFirst({
      where: { id: input.liquidationId, tenantId: input.tenantId },
    });

    if (!latest) {
      throw new NotFoundException(`Liquidación no encontrada: ${input.liquidationId}`);
    }

    if (latest.status === 'DRAFT') {
      throw new ConflictException(`La liquidación ${input.liquidationId} cambió durante la revisión`);
    }

    throw new ConflictException(
      `Solo se puede revisar una liquidación en DRAFT. Estado actual: ${latest.status}`,
    );
  }

  await deps.createAuditLogRequired(
    {
      tenantId: input.tenantId,
      actorMembershipId: input.membershipId,
      action: 'LIQUIDATION_REVIEW',
      entityType: 'Liquidation',
      entityId: input.liquidationId,
      metadata: {
        period: current.period,
        buildingId: current.buildingId,
        reviewedAt: now.toISOString(),
      },
    },
    tx,
  );

  const updated = await tx.liquidation.findFirst({
    where: { id: input.liquidationId, tenantId: input.tenantId },
  });

  if (!updated) {
    throw new NotFoundException(`Liquidación no encontrada: ${input.liquidationId}`);
  }

  return updated as LiquidationRecord;
}

@Injectable()
export class LiquidationPublicationUseCase {
  constructor(private readonly deps: LiquidationWorkflowDependencies) {}

  async execute(
    tenantId: string,
    liquidationId: string,
    membershipId: string,
    dto: PublishLiquidationDto,
    notificationPolicy: NotificationPolicy = 'post-commit',
  ): Promise<LiquidationResponseDto> {
    let publishResult: { liquidation: LiquidationResponseDto; publishedNow: boolean } | null = null;
    let actorUserId: string | null = null;

    try {
      publishResult = await this.deps.prisma.$transaction(
        async (tx) => {
          const membership = await requireFinanceMembership(
            tx as unknown as FinanceMembershipClient,
            tenantId,
            membershipId,
            this.deps.isAdminOrOperator,
          );
          actorUserId = membership.userId;

          const current = await tx.liquidation.findFirst({
            where: { id: liquidationId, tenantId },
          });

          if (!current) {
            throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
          }

          if (current.status === 'PUBLISHED') {
            return {
              liquidation: this.deps.toPublishedLiquidationDto(current as LiquidationRecord),
              publishedNow: false,
            };
          }

          if (current.status !== 'REVIEWED') {
            throw new BadRequestException(
              `Solo se puede publicar una liquidación revisada. Estado actual: ${current.status}`,
            );
          }

          const publicationExpenses = getPublicationSnapshotExpenses(current.expenseSnapshot);
          const valuationMode = current.valuationMode ?? 'LEGACY_NOMINAL';
          assertLiquidationMovementCurrency(
            publicationExpenses,
            current.baseCurrency,
            valuationMode,
          );

          // FIN-06R2: clasificación por PRESENCIA del modelo FIN-06, nunca por
          // offset > 0. Un draft FIN-06 legítimo puede tener offset 0, y una
          // row corrompida a offset 0 no debe degradarse a legacy/V2.
          // `!= null` trata null y undefined como ausencia (legacy).
          const hasFin06Summary =
            current.grossExpenseAmountMinor != null ||
            current.adjustmentAmountMinor != null ||
            current.preIncomeAmountMinor != null ||
            current.incomeOffsetAmountMinor != null ||
            current.netDistributableAmountMinor != null;
          const hasFin06JsonArtifacts =
            current.incomeOffsetSnapshot != null ||
            current.incomeOffsetsByCurrency != null;

          // FIN-06R3: las referencias relacionales también clasifican FIN-06.
          // Una row corrompida a summary+JSON null pero con LiquidationIncomeOffset
          // rows NO puede degradarse a legacy.
          const fin06ReferenceCount = await tx.liquidationIncomeOffset.count({
            where: { tenantId, liquidationId },
          });
          const hasFin06RelationalArtifacts = fin06ReferenceCount > 0;

          const isFin06Liquidation =
            hasFin06Summary || hasFin06JsonArtifacts || hasFin06RelationalArtifacts;

          let incomeOffsetReferences: Array<{
            incomeApplicationId: string;
            buildingId: string;
            originalAmountMinor: number;
            currencyCode: string;
            valuedAmountMinor: number;
            baseCurrency: string;
          }> = [];

          if (isFin06Liquidation) {
            // Contrato FIN-06 completo: todos los summary fields presentes.
            if (
              current.grossExpenseAmountMinor === null ||
              current.adjustmentAmountMinor === null ||
              current.preIncomeAmountMinor === null ||
              current.incomeOffsetAmountMinor === null ||
              current.netDistributableAmountMinor === null
            ) {
              throw new UnprocessableEntityException({
                statusCode: 422,
                error: 'LIQUIDATION_INCOME_SOURCE_DRIFT',
                message:
                  'La liquidación posee evidencia FIN-06 pero su resumen está incompleto; no se publica',
              });
            }

            // FIN-06R: reconciliación EXACTA snapshot ↔ relations ↔ current.
            const snapshotOffsets = parseIncomeOffsetSnapshotItems(
              current.incomeOffsetSnapshot,
            );
            const snapshotByApplicationId = new Map(
              snapshotOffsets.map((offset) => [offset.incomeApplicationId, offset]),
            );

            incomeOffsetReferences = await tx.liquidationIncomeOffset.findMany({
              where: { tenantId, liquidationId },
              select: {
                incomeApplicationId: true,
                buildingId: true,
                originalAmountMinor: true,
                currencyCode: true,
                valuedAmountMinor: true,
                baseCurrency: true,
              },
            });

            const referenceByApplicationId = new Map(
              incomeOffsetReferences.map((reference) => [
                reference.incomeApplicationId,
                reference,
              ]),
            );

            // Cardinalidad: snapshot count == reference count == unique IDs.
            const snapshotIds = snapshotOffsets.map((offset) => offset.incomeApplicationId);
            const referenceIds = incomeOffsetReferences.map(
              (reference) => reference.incomeApplicationId,
            );
            const snapshotIdSet = new Set(snapshotIds);
            const referenceIdSet = new Set(referenceIds);

            if (
              snapshotIds.length !== snapshotIdSet.size ||
              referenceIds.length !== referenceIdSet.size ||
              snapshotIdSet.size !== referenceIdSet.size ||
              ![...snapshotIdSet].every((id) => referenceIdSet.has(id))
            ) {
              throw new UnprocessableEntityException({
                statusCode: 422,
                error: 'LIQUIDATION_INCOME_SOURCE_DRIFT',
                message:
                  'El snapshot de income offsets no reconcilia cardinalidad con las referencias; no se publica',
              });
            }

            const applicationIds = referenceIds;
            const applications = await tx.incomeApplication.findMany({
              where: { tenantId, id: { in: applicationIds } },
              select: {
                id: true,
                incomeId: true,
                destinationType: true,
                amountMinor: true,
                currencyCode: true,
                policyVersionId: true,
                legacyDestination: true,
                income: { select: { id: true, status: true, period: true } },
              },
            });
            const applicationById = new Map(applications.map((app) => [app.id, app]));

            let relationalValuedTotal = 0;

            for (const reference of incomeOffsetReferences) {
              const snapshot = snapshotByApplicationId.get(reference.incomeApplicationId);
              const application = applicationById.get(reference.incomeApplicationId);

              if (!snapshot || !application) {
                throw new UnprocessableEntityException({
                  statusCode: 422,
                  error: 'LIQUIDATION_INCOME_SOURCE_DRIFT',
                  message: `La fuente de income offset ${reference.incomeApplicationId} no reconcilia; no se publica`,
                });
              }

              // Equality estricta contra el snapshot (no comparaciones parciales).
              if (
                snapshot.incomeApplicationId !== reference.incomeApplicationId ||
                snapshot.buildingAmountMinor !== reference.originalAmountMinor ||
                snapshot.valuedAmountMinor !== reference.valuedAmountMinor ||
                snapshot.currencyCode !== reference.currencyCode ||
                snapshot.period !== current.period ||
                reference.buildingId !== current.buildingId ||
                reference.baseCurrency !== current.baseCurrency ||
                application.destinationType !== 'OFFSET_EXPENSES' ||
                application.amountMinor !== snapshot.applicationAmountMinor ||
                application.currencyCode !== snapshot.currencyCode ||
                application.policyVersionId !== snapshot.policyVersionId ||
                (application.legacyDestination ?? null) !==
                  (snapshot.legacyDestination ?? null) ||
                application.income === null ||
                application.income.id !== snapshot.incomeId ||
                application.income.status !== 'RECORDED' ||
                application.income.period !== current.period
              ) {
                throw new UnprocessableEntityException({
                  statusCode: 422,
                  error: 'LIQUIDATION_INCOME_SOURCE_DRIFT',
                  message: `La fuente de income offset ${reference.incomeApplicationId} cambió desde el draft; no se publica`,
                });
              }

              relationalValuedTotal += reference.valuedAmountMinor;
            }

            // Reconciliación relacional del total valorado.
            if (relationalValuedTotal !== current.incomeOffsetAmountMinor) {
              throw new UnprocessableEntityException({
                statusCode: 422,
                error: 'LIQUIDATION_INCOME_SOURCE_DRIFT',
                message:
                  'La suma valorada de referencias no coincide con el total de income offsets; no se publica',
              });
            }

            const snapshotValuedTotal = snapshotOffsets.reduce(
              (sum, offset) => sum + offset.valuedAmountMinor,
              0,
            );
            if (snapshotValuedTotal !== current.incomeOffsetAmountMinor) {
              throw new UnprocessableEntityException({
                statusCode: 422,
                error: 'LIQUIDATION_INCOME_SOURCE_DRIFT',
                message:
                  'La suma valorada del snapshot no coincide con el total de income offsets; no se publica',
              });
            }

            // FIN-06R: incomeOffsetsByCurrency debe reconciliar exactamente a
            // { baseCurrency: incomeOffsetAmountMinor } cuando offset > 0.
            if (current.incomeOffsetsByCurrency === null) {
              throw new UnprocessableEntityException({
                statusCode: 422,
                error: 'LIQUIDATION_INCOME_SOURCE_DRIFT',
                message:
                  'incomeOffsetsByCurrency falta en una liquidación FIN-06; no se publica',
              });
            }
            const incomeOffsetsByCurrency = parseTotalsByCurrency(
              current.incomeOffsetsByCurrency,
            );
            if (current.incomeOffsetAmountMinor > 0) {
              const expected = {
                [current.baseCurrency]: current.incomeOffsetAmountMinor,
              };
              const isExact =
                Object.keys(incomeOffsetsByCurrency).length === 1 &&
                incomeOffsetsByCurrency[current.baseCurrency] ===
                  expected[current.baseCurrency];
              if (!isExact) {
                throw new UnprocessableEntityException({
                  statusCode: 422,
                  error: 'LIQUIDATION_INCOME_SOURCE_DRIFT',
                  message:
                    'incomeOffsetsByCurrency no reconcilia con el total de income offsets; no se publica',
                });
              }
            } else if (Object.keys(incomeOffsetsByCurrency).length > 0) {
              throw new UnprocessableEntityException({
                statusCode: 422,
                error: 'LIQUIDATION_INCOME_SOURCE_DRIFT',
                message:
                  'incomeOffsetsByCurrency no es consistente con offset cero; no se publica',
              });
            }
          }

          const valuedSourceTotal =
            valuationMode === 'FUNCTIONAL'
              ? publicationExpenses.reduce(
                  (sum, expense) => sum + (expense.functionalAmountMinor ?? NaN),
                  0,
                )
              : publicationExpenses.reduce((sum, expense) => sum + expense.amountMinor, 0);

          if (!Number.isSafeInteger(valuedSourceTotal)) {
            throw new UnprocessableEntityException({
              statusCode: 422,
              error: 'LIQUIDATION_PUBLICATION_SOURCE_DRIFT',
              message:
                'El snapshot de fuentes de la liquidación no reconcilia con su total; no se publica',
            });
          }

          // FIN-06: gross + adjustments = preIncome; preIncome - offsets = net.
          if (isFin06Liquidation) {
            if (
              valuedSourceTotal !== current.preIncomeAmountMinor ||
              (current.preIncomeAmountMinor ?? 0) -
                (current.incomeOffsetAmountMinor ?? 0) !==
                current.totalAmountMinor ||
              current.totalAmountMinor !== current.netDistributableAmountMinor
            ) {
              throw new UnprocessableEntityException({
                statusCode: 422,
                error: 'LIQUIDATION_PUBLICATION_SOURCE_DRIFT',
                message:
                  'El desglose FIN-06 de la liquidación no reconcilia (preIncome/offsets/net); no se publica',
              });
            }
          } else if (valuedSourceTotal !== current.totalAmountMinor) {
            throw new UnprocessableEntityException({
              statusCode: 422,
              error: 'LIQUIDATION_PUBLICATION_SOURCE_DRIFT',
              message:
                'El snapshot de fuentes de la liquidación no reconcilia con su total; no se publica',
            });
          }

          const billableUnits = await tx.unit.findMany({
            where: { tenantId, buildingId: current.buildingId, isBillable: true },
            include: { unitCategory: { select: { coefficient: true, id: true } } },
            orderBy: { code: 'asc' },
          });

          if (billableUnits.length === 0) {
            throw new BadRequestException('No hay unidades facturables en este edificio');
          }

          const now = new Date();
          const dueDate = new Date(dto.dueDate);
          if (Number.isNaN(dueDate.getTime())) {
            throw new BadRequestException('dueDate must be a valid date');
          }

          const distribution = calculateDistribution(
            billableUnits,
            current.totalAmountMinor,
            current.buildingId,
          );

          let publicationSnapshot: Prisma.InputJsonObject;
          let snapshotVersion: number;

          if (isFin06Liquidation) {
            const incomeOffsets = parseIncomeOffsetSnapshotItems(
              current.incomeOffsetSnapshot,
            );
            publicationSnapshot = buildLiquidationPublicationSnapshotV3({
              liquidationId: current.id,
              tenantId,
              buildingId: current.buildingId,
              period: current.period,
              valuationMode,
              baseCurrency: current.baseCurrency,
              totalAmountMinor: current.totalAmountMinor,
              totalsByCurrency: parseTotalsByCurrency(current.totalsByCurrency),
              grossExpenseAmountMinor: current.grossExpenseAmountMinor as number,
              adjustmentAmountMinor: current.adjustmentAmountMinor as number,
              preIncomeAmountMinor: current.preIncomeAmountMinor as number,
              incomeOffsetAmountMinor: current.incomeOffsetAmountMinor as number,
              netDistributableAmountMinor: current.netDistributableAmountMinor as number,
              incomeOffsetsByCurrency: parseTotalsByCurrency(current.incomeOffsetsByCurrency),
              expenses: publicationExpenses,
              incomeOffsets,
              allocations: distribution.map((item) => ({
                unitId: item.unitId,
                unitCode: item.unitCode,
                unitLabel: item.unitLabel,
                amountMinor: item.amountMinor,
              })),
              dueDate,
              publishedAt: now,
            });
            snapshotVersion = 3;
          } else {
            publicationSnapshot = buildLiquidationPublicationSnapshot({
              liquidationId: current.id,
              tenantId,
              buildingId: current.buildingId,
              period: current.period,
              valuationMode,
              baseCurrency: current.baseCurrency,
              totalAmountMinor: current.totalAmountMinor,
              totalsByCurrency: parseTotalsByCurrency(current.totalsByCurrency),
              expenses: publicationExpenses,
              allocations: distribution.map((item) => ({
                unitId: item.unitId,
                unitCode: item.unitCode,
                unitLabel: item.unitLabel,
                amountMinor: item.amountMinor,
              })),
              dueDate,
              publishedAt: now,
            });
            snapshotVersion = 2;
          }

          const duplicatePublished = await tx.liquidation.findFirst({
            where: {
              tenantId,
              buildingId: current.buildingId,
              period: current.period,
              status: 'PUBLISHED',
              id: { not: liquidationId },
            },
            select: { id: true },
          });

          if (duplicatePublished) {
            throw new ConflictException(
              `Ya existe una liquidación publicada para el período ${current.period}`,
            );
          }

          const concept = `Expensas comunes ${current.period}`;
          const expectedCharges =
            current.totalAmountMinor === 0
              ? []
              : distribution.map((distributionItem) => ({
                  tenantId,
                  buildingId: current.buildingId,
                  unitId: distributionItem.unitId,
                  period: current.period,
                  type: 'COMMON_EXPENSE' as const,
                  concept,
                  amount: distributionItem.amountMinor,
                  currency: current.baseCurrency,
                  dueDate,
                   liquidationId,
                 }));

          const publicationUnitIds = expectedCharges.map(({ unitId }) => unitId);
          await lockUnitsFinancialMutations(tx, tenantId, publicationUnitIds);
          for (const unitId of [...new Set(publicationUnitIds)].sort()) {
            await lockUnitChargesForAllocation(tx, tenantId, current.buildingId, unitId);
          }

          const existingCharges = await tx.charge.findMany({
            where: {
              tenantId,
              liquidationId,
              buildingId: current.buildingId,
              period: current.period,
            },
            select: {
              unitId: true,
              amount: true,
              currency: true,
              dueDate: true,
              buildingId: true,
              period: true,
              liquidationId: true,
              concept: true,
            },
            orderBy: { unitId: 'asc' },
          });

          if (existingCharges.length > 0) {
            if (existingCharges.length !== expectedCharges.length) {
              throw new ConflictException(
                `La liquidación ${liquidationId} tiene cargos parciales generados para ${current.period}`,
              );
            }

            const expectedChargesByUnit = new Map(
              expectedCharges.map((charge) => [charge.unitId, charge]),
            );

            for (const existingCharge of existingCharges) {
              const expectedCharge = expectedChargesByUnit.get(existingCharge.unitId);

              if (
                !expectedCharge ||
                existingCharge.amount !== expectedCharge.amount ||
                existingCharge.currency !== expectedCharge.currency ||
                existingCharge.buildingId !== expectedCharge.buildingId ||
                existingCharge.period !== expectedCharge.period ||
                existingCharge.liquidationId !== expectedCharge.liquidationId ||
                existingCharge.concept !== expectedCharge.concept ||
                existingCharge.dueDate.getTime() !== expectedCharge.dueDate.getTime()
              ) {
                throw new ConflictException(
                  `La liquidación ${liquidationId} tiene cargos existentes que no coinciden con la publicación esperada`,
                );
              }
            }
          } else if (expectedCharges.length > 0) {
            await tx.charge.createMany({
              data: expectedCharges.map((charge) => ({
                ...charge,
                status: ChargeStatus.PENDING,
                createdByMembershipId: membership.id,
              })),
            });
          }

          const updateResult = await tx.liquidation.updateMany({
            where: {
              id: liquidationId,
              tenantId,
              status: 'REVIEWED',
              publicationSnapshot: { equals: Prisma.DbNull },
            },
            data: {
              status: 'PUBLISHED',
              publicationSnapshot,
              publishedByMembershipId: membership.id,
              publishedAt: now,
              updatedAt: now,
            },
          });

          if (updateResult.count === 0) {
            const currentPublication = await tx.liquidation.findFirst({
              where: { id: liquidationId, tenantId },
            });

            if (!currentPublication) {
              throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
            }

            if (currentPublication.status === 'PUBLISHED') {
              return {
                liquidation: this.deps.toPublishedLiquidationDto(currentPublication as LiquidationRecord),
                publishedNow: false,
              };
            }

            throw new ConflictException(
              `La liquidación ${liquidationId} cambió durante la operación`,
            );
          }

          await this.deps.createAuditLogRequired(
            {
              tenantId,
              actorMembershipId: membership.id,
              action: 'LIQUIDATION_PUBLISH',
              entityType: 'Liquidation',
              entityId: liquidationId,
              metadata: {
                period: current.period,
                buildingId: current.buildingId,
                chargesCount: expectedCharges.length,
                allocationCount: distribution.length,
                totalAmountMinor: current.totalAmountMinor,
                baseCurrency: current.baseCurrency,
                snapshotVersion,
                dueDate: dueDate.toISOString().slice(0, 10),
                publishedAt: now.toISOString(),
                ...(isFin06Liquidation
                  ? {
                      grossExpenseAmountMinor: current.grossExpenseAmountMinor,
                      adjustmentAmountMinor: current.adjustmentAmountMinor,
                      preIncomeAmountMinor: current.preIncomeAmountMinor,
                      incomeOffsetAmountMinor: current.incomeOffsetAmountMinor,
                      netDistributableAmountMinor: current.netDistributableAmountMinor,
                      incomeOffsetCount: incomeOffsetReferences.length,
                    }
                  : {}),
              },
            },
            tx,
          );

          const liquidation = await tx.liquidation.findFirst({
            where: { id: liquidationId, tenantId },
          });

          if (!liquidation) {
            throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
          }

          return {
            liquidation: this.deps.toPublishedLiquidationDto(liquidation as LiquidationRecord),
            publishedNow: true,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isSerializationConflict(error)) {
        const current = await this.deps.prisma.liquidation.findFirst({
          where: { id: liquidationId, tenantId },
        });

        if (current?.status === 'PUBLISHED') {
          return this.deps.toPublishedLiquidationDto(current as LiquidationRecord);
        }

        throw new ConflictException(
          `La liquidación ${liquidationId} cambió durante la operación`,
        );
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const current = await this.deps.prisma.liquidation.findFirst({
          where: { id: liquidationId, tenantId },
        });

        if (current?.status === 'PUBLISHED') {
          return this.deps.toPublishedLiquidationDto(current as LiquidationRecord);
        }

        throw new ConflictException(
          `La liquidación ${liquidationId} ya tiene cargos generados para ${current?.period ?? 'este período'}`,
        );
      }

      throw error;
    }

    if (!publishResult) {
      throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
    }

    if (publishResult.publishedNow && notificationPolicy === 'post-commit') {
      const notificationResult = await this.deps.sendChargePublishedNotifications(
        tenantId,
        liquidationId,
        {
          period: publishResult.liquidation.period,
          buildingId: publishResult.liquidation.buildingId,
          baseCurrency: publishResult.liquidation.baseCurrency,
        },
        actorUserId ?? undefined,
      );

      if (notificationResult.failedCount > 0) {
        await this.deps.createAuditLog({
          tenantId,
          action: 'LIQUIDATION_PUBLISH',
          entityType: 'Liquidation',
          entityId: liquidationId,
          metadata: {
            period: publishResult.liquidation.period,
            buildingId: publishResult.liquidation.buildingId,
            notificationFailure: true,
            errors: notificationResult.errorMessages,
          },
        });
      }
    }

    return publishResult.liquidation;
  }
}

export function parseTotalsByCurrency(value: unknown): Record<string, number> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Liquidation totalsByCurrency snapshot is invalid');
  }

  const result: Record<string, number> = {};

  for (const [currency, amount] of Object.entries(value as Record<string, unknown>)) {
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) {
      throw new BadRequestException(
        `Liquidation totalsByCurrency snapshot has invalid amount for ${currency}`,
      );
    }

    result[currency] = amount;
  }

  return result;
}

function isSerializationConflict(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

interface ParsedLiquidationExpenseItem {
  expenseId: string;
  categoryName: string;
  vendorName: string | null;
  amountMinor: number;
  currencyCode: string;
  invoiceDate: string;
  description: string | null;
  type: 'EXPENSE' | 'ADJUSTMENT';
  sourcePeriod?: string;
  functionalAmountMinor?: number;
  functionalCurrencyCode?: string;
  exchangeRateId?: string;
  exchangeRateValue?: string;
  exchangeRateDirection?: string;
  exchangeRateEffectiveAt?: string;
  conversionDate?: string;
}

function parseExpenseSnapshot(value: unknown): ParsedLiquidationExpenseItem[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException('Liquidation expense snapshot is invalid');
  }

  return value.map((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new BadRequestException(`Liquidation expense snapshot item ${index} is invalid`);
    }

    const snapshot = item as Record<string, unknown>;
    const expenseId = snapshot.expenseId;
    const categoryName = snapshot.categoryName;
    const vendorName = snapshot.vendorName;
    const amountMinor = snapshot.amountMinor;
    const currencyCode = snapshot.currencyCode;
    const invoiceDate = snapshot.invoiceDate;
    const description = snapshot.description;
    const type = snapshot.type;
    const sourcePeriod = snapshot.sourcePeriod;
    const functionalAmountMinor = snapshot.functionalAmountMinor;
    const functionalCurrencyCode = snapshot.functionalCurrencyCode;
    const exchangeRateId = snapshot.exchangeRateId;
    const exchangeRateValue = snapshot.exchangeRateValue;
    const exchangeRateDirection = snapshot.exchangeRateDirection;
    const exchangeRateEffectiveAt = snapshot.exchangeRateEffectiveAt;
    const conversionDate = snapshot.conversionDate;

    if (typeof expenseId !== 'string') {
      throw new BadRequestException(`Liquidation expense snapshot item ${index} has invalid expenseId`);
    }
    if (typeof categoryName !== 'string') {
      throw new BadRequestException(`Liquidation expense snapshot item ${index} has invalid categoryName`);
    }
    if (vendorName !== null && typeof vendorName !== 'string') {
      throw new BadRequestException(`Liquidation expense snapshot item ${index} has invalid vendorName`);
    }
    if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor) || amountMinor < 0) {
      throw new BadRequestException(`Liquidation expense snapshot item ${index} has invalid amountMinor`);
    }
    if (typeof currencyCode !== 'string') {
      throw new BadRequestException(`Liquidation expense snapshot item ${index} has invalid currencyCode`);
    }
    if (typeof invoiceDate !== 'string') {
      throw new BadRequestException(`Liquidation expense snapshot item ${index} has invalid invoiceDate`);
    }
    if (description !== null && typeof description !== 'string') {
      throw new BadRequestException(`Liquidation expense snapshot item ${index} has invalid description`);
    }
    if (type !== 'EXPENSE' && type !== 'ADJUSTMENT') {
      throw new BadRequestException(`Liquidation expense snapshot item ${index} has invalid type`);
    }
    if (sourcePeriod !== undefined && sourcePeriod !== null && typeof sourcePeriod !== 'string') {
      throw new BadRequestException(`Liquidation expense snapshot item ${index} has invalid sourcePeriod`);
    }

    const parsedInvoiceDate = new Date(invoiceDate);
    if (Number.isNaN(parsedInvoiceDate.getTime())) {
      throw new BadRequestException(`Liquidation expense snapshot item ${index} has invalid invoiceDate`);
    }

    const parseOptionalInt = (value: unknown, field: string): number | undefined => {
      if (value === null || value === undefined) {
        return undefined;
      }
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new BadRequestException(
          `Liquidation expense snapshot item ${index} has invalid ${field}`,
        );
      }
      return value;
    };

    const parseOptionalString = (value: unknown, field: string): string | undefined => {
      if (value === null || value === undefined) {
        return undefined;
      }
      if (typeof value !== 'string' || value.length === 0) {
        throw new BadRequestException(
          `Liquidation expense snapshot item ${index} has invalid ${field}`,
        );
      }
      return value;
    };

    const parseOptionalIsoDate = (value: unknown, field: string): string | undefined => {
      if (value === null || value === undefined) {
        return undefined;
      }
      const parsed = new Date(String(value));
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException(
          `Liquidation expense snapshot item ${index} has invalid ${field}`,
        );
      }
      return parsed.toISOString();
    };

    const parsedFunctionalAmountMinor = parseOptionalInt(functionalAmountMinor, 'functionalAmountMinor');
    const parsedFunctionalCurrencyCode = parseOptionalString(functionalCurrencyCode, 'functionalCurrencyCode');
    const parsedExchangeRateId = parseOptionalString(exchangeRateId, 'exchangeRateId');
    const parsedExchangeRateValue = parseOptionalString(
      exchangeRateValue === null || exchangeRateValue === undefined
        ? undefined
        : String(exchangeRateValue),
      'exchangeRateValue',
    );
    const parsedExchangeRateDirection = parseOptionalString(exchangeRateDirection, 'exchangeRateDirection');
    const parsedExchangeRateEffectiveAt = parseOptionalIsoDate(exchangeRateEffectiveAt, 'exchangeRateEffectiveAt');
    const parsedConversionDate = parseOptionalIsoDate(conversionDate, 'conversionDate');

    return {
      expenseId,
      categoryName,
      vendorName,
      amountMinor,
      currencyCode,
      invoiceDate: parsedInvoiceDate.toISOString(),
      description,
      type,
      sourcePeriod: sourcePeriod ?? undefined,
      functionalAmountMinor: parsedFunctionalAmountMinor,
      functionalCurrencyCode: parsedFunctionalCurrencyCode,
      exchangeRateId: parsedExchangeRateId,
      exchangeRateValue: parsedExchangeRateValue,
      exchangeRateDirection: parsedExchangeRateDirection,
      exchangeRateEffectiveAt: parsedExchangeRateEffectiveAt,
      conversionDate: parsedConversionDate,
    };
  });
}

function parseIncomeOffsetSnapshotItems(value: unknown): PublishedIncomeOffsetSnapshot[] {
  if (!Array.isArray(value)) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'LIQUIDATION_INCOME_SOURCE_DRIFT',
      message: 'El snapshot de income offsets de la liquidación es inválido; no se publica',
    });
  }

  return value.map((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'LIQUIDATION_INCOME_SOURCE_DRIFT',
        message: `Income offset snapshot item ${index} es inválido`,
      });
    }

    const snapshot = item as Record<string, unknown>;
    const incomeId = snapshot.incomeId;
    const incomeApplicationId = snapshot.incomeApplicationId;
    const categoryId = snapshot.categoryId;
    const categoryName = snapshot.categoryName;
    const policyVersionId = snapshot.policyVersionId;
    const scopeType = snapshot.scopeType;
    const currencyCode = snapshot.currencyCode;
    const applicationAmountMinor = snapshot.applicationAmountMinor;
    const buildingAmountMinor = snapshot.buildingAmountMinor;
    const valuedAmountMinor = snapshot.valuedAmountMinor;
    const functionalCurrencyCode = snapshot.functionalCurrencyCode;
    const exchangeRateId = snapshot.exchangeRateId;
    const exchangeRateValue = snapshot.exchangeRateValue;
    const exchangeRateDirection = snapshot.exchangeRateDirection;
    const exchangeRateEffectiveAt = snapshot.exchangeRateEffectiveAt;
    const conversionDate = snapshot.conversionDate;
    const receivedDate = snapshot.receivedDate;
    const period = snapshot.period;

    const requiredString = (fieldName: string): string => {
      if (typeof snapshot[fieldName] !== 'string' || (snapshot[fieldName] as string).length === 0) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: 'LIQUIDATION_INCOME_SOURCE_DRIFT',
          message: `Income offset snapshot item ${index} tiene ${fieldName} inválido`,
        });
      }
      return snapshot[fieldName] as string;
    };

    const requiredInt = (fieldName: string): number => {
      const value = snapshot[fieldName];
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: 'LIQUIDATION_INCOME_SOURCE_DRIFT',
          message: `Income offset snapshot item ${index} tiene ${fieldName} inválido`,
        });
      }
      return value;
    };

    const nullableString = (fieldName: string): string | null => {
      const value = snapshot[fieldName];
      if (value === null || value === undefined) {
        return null;
      }
      return requiredString(fieldName);
    };

    const nullableIsoDate = (fieldName: string): string | null => {
      const value = snapshot[fieldName];
      if (value === null || value === undefined) {
        return null;
      }
      const parsed = new Date(String(value));
      if (Number.isNaN(parsed.getTime())) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: 'LIQUIDATION_INCOME_SOURCE_DRIFT',
          message: `Income offset snapshot item ${index} tiene ${fieldName} inválido`,
        });
      }
      return parsed.toISOString();
    };

    return {
      incomeId: requiredString('incomeId'),
      incomeApplicationId: requiredString('incomeApplicationId'),
      categoryId: nullableString('categoryId') ?? '',
      categoryName: nullableString('categoryName'),
      policyVersionId: nullableString('policyVersionId'),
      legacyDestination: nullableString('legacyDestination'),
      scopeType: requiredString('scopeType'),
      currencyCode: requiredString('currencyCode'),
      applicationAmountMinor: requiredInt('applicationAmountMinor'),
      buildingAmountMinor: requiredInt('buildingAmountMinor'),
      valuedAmountMinor: requiredInt('valuedAmountMinor'),
      functionalCurrencyCode: nullableString('functionalCurrencyCode'),
      exchangeRateId: nullableString('exchangeRateId'),
      exchangeRateValue: nullableString('exchangeRateValue'),
      exchangeRateDirection: nullableString('exchangeRateDirection'),
      exchangeRateEffectiveAt: nullableIsoDate('exchangeRateEffectiveAt'),
      conversionDate: nullableIsoDate('conversionDate'),
      receivedDate: requiredString('receivedDate'),
      period: requiredString('period'),
    };
  });
}

function getPublicationSnapshotExpenses(
  value: unknown,
): ReadonlyArray<PublishedExpenseSnapshot> {
  return parseExpenseSnapshot(value).map((expense) => ({
    expenseId: expense.expenseId,
    categoryName: expense.categoryName,
    vendorName: expense.vendorName,
    amountMinor: expense.amountMinor,
    currencyCode: expense.currencyCode,
    invoiceDate: expense.invoiceDate,
    description: expense.description,
    type: expense.type,
    ...(expense.sourcePeriod ? { sourcePeriod: expense.sourcePeriod } : {}),
    ...(expense.functionalAmountMinor !== null && expense.functionalAmountMinor !== undefined
      ? { functionalAmountMinor: expense.functionalAmountMinor }
      : {}),
    ...(expense.functionalCurrencyCode !== null && expense.functionalCurrencyCode !== undefined
      ? { functionalCurrencyCode: expense.functionalCurrencyCode }
      : {}),
    ...(expense.exchangeRateId !== null && expense.exchangeRateId !== undefined
      ? { exchangeRateId: expense.exchangeRateId }
      : {}),
    ...(expense.exchangeRateValue !== null && expense.exchangeRateValue !== undefined
      ? { exchangeRateValue: expense.exchangeRateValue }
      : {}),
    ...(expense.exchangeRateDirection !== null && expense.exchangeRateDirection !== undefined
      ? { exchangeRateDirection: expense.exchangeRateDirection }
      : {}),
    ...(expense.exchangeRateEffectiveAt !== null && expense.exchangeRateEffectiveAt !== undefined
      ? { exchangeRateEffectiveAt: expense.exchangeRateEffectiveAt }
      : {}),
    ...(expense.conversionDate !== null && expense.conversionDate !== undefined
      ? { conversionDate: expense.conversionDate }
      : {}),
  }));
}

function calculateDistribution(
  units: Array<{
    id: string;
    code: string;
    label: string | null;
    unitCategory: { id: string; coefficient: number } | null;
  }>,
  totalAmountMinor: number,
  buildingId: string,
): Array<{ unitId: string; unitCode: string; unitLabel: string | null; amountMinor: number }> {
  if (units.length === 0) {
    throw new BadRequestException(`No billable units found for building ${buildingId}`);
  }

  const unitsWithWeight = units.map((unit) => ({
    unitId: unit.id,
    unitCode: unit.code,
    unitLabel: unit.label,
    weight: unit.unitCategory?.coefficient && unit.unitCategory.coefficient > 0
      ? unit.unitCategory.coefficient
      : 1,
  }));

  const totalWeight = unitsWithWeight.reduce((sum, unit) => sum + unit.weight, 0);

  if (totalWeight <= 0) {
    throw new BadRequestException(`Invalid unit coefficients for building ${buildingId}`);
  }

  const allocations = unitsWithWeight.map((unit) => ({
    ...unit,
    rawAmount: (totalAmountMinor * unit.weight) / totalWeight,
  }));

  const roundedAllocations = allocations.map((unit) => ({
    unitId: unit.unitId,
    unitCode: unit.unitCode,
    unitLabel: unit.unitLabel,
    amountMinor: Math.floor(unit.rawAmount),
    fractionalRemainder: unit.rawAmount - Math.floor(unit.rawAmount),
  }));

  let allocatedTotal = roundedAllocations.reduce((sum, item) => sum + item.amountMinor, 0);
  let remainder = totalAmountMinor - allocatedTotal;

  roundedAllocations
    .sort((left, right) => right.fractionalRemainder - left.fractionalRemainder)
    .forEach((item) => {
      if (remainder > 0) {
        item.amountMinor += 1;
        remainder -= 1;
      }
    });

  allocatedTotal = roundedAllocations.reduce((sum, item) => sum + item.amountMinor, 0);

  if (allocatedTotal !== totalAmountMinor) {
    throw new BadRequestException(
      `Distribution total ${allocatedTotal} does not match liquidation total ${totalAmountMinor}`,
    );
  }

  return roundedAllocations
    .map(({ unitId, unitCode, unitLabel, amountMinor }) => ({
      unitId,
      unitCode,
      unitLabel,
      amountMinor,
    }))
    .sort((left, right) => left.unitCode.localeCompare(right.unitCode));
}
