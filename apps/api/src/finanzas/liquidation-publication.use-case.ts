import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ChargeStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { FinanzasValidators } from './finanzas.validators';
import {
  buildLiquidationPublicationSnapshot,
  type PublishedExpenseSnapshot,
} from './liquidation-publication-snapshot';
import {
  type LiquidationResponseDto,
  type PublishLiquidationDto,
} from './expense-ledger.dto';

export type NotificationPolicy = 'post-commit' | 'disabled';

interface FinanceMembershipRecord {
  id: string;
  tenantId: string;
  roles: Array<{
    role: string;
    scopeType: 'TENANT' | 'BUILDING' | 'UNIT';
  }>;
}

export interface FinanceMembershipContext {
  readonly id: string;
  readonly tenantId: string;
  readonly roles: string[];
}

interface FinanceMembershipClient {
  membership: {
    findFirst: (args: {
      where: { id: string; tenantId: string };
      select: {
        id: boolean;
        tenantId: boolean;
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
  ) => Promise<NotificationDispatchResult>;
}

type LiquidationRecord = {
  id: string;
  tenantId: string;
  buildingId: string;
  period: string;
  chargePeriod: string | null;
  status: 'DRAFT' | 'REVIEWED' | 'PUBLISHED' | 'CANCELED';
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
};

type LiquidationResponseRecord = Omit<LiquidationRecord, 'expenseSnapshot' | 'publicationSnapshot'>;

export interface DraftLiquidationInput {
  readonly tenantId: string;
  readonly buildingId: string;
  readonly period: string;
  readonly chargePeriod?: string | null;
  readonly baseCurrency: string;
  readonly totalAmountMinor: number;
  readonly totalsByCurrency: Prisma.InputJsonObject;
  readonly expenseSnapshot: Prisma.InputJsonArray;
  readonly unitCount: number;
  readonly generatedByMembershipId: string;
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
    baseCurrency: liquidation.baseCurrency,
    totalAmountMinor: liquidation.totalAmountMinor,
    totalsByCurrency: parseTotalsByCurrency(liquidation.totalsByCurrency),
    unitCount: liquidation.unitCount,
    generatedAt: liquidation.generatedAt,
    reviewedAt: liquidation.reviewedAt,
    publishedAt: liquidation.publishedAt,
    canceledAt: liquidation.canceledAt,
    createdAt: liquidation.createdAt,
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
      if (!occupant.member?.user?.id) {
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
    sendChargePublishedNotifications: (tenantId, liquidationId, liquidation) =>
      sendChargePublishedNotifications(
        params.prisma,
        params.notificationsService,
        tenantId,
        liquidationId,
        liquidation,
      ),
  };
}

export async function createLiquidationDraftRecord(
  tx: Prisma.TransactionClient,
  deps: Pick<LiquidationWorkflowDependencies, 'createAuditLogRequired'>,
  input: DraftLiquidationInput,
): Promise<LiquidationRecord> {
  const liquidation = await tx.liquidation.create({
    data: {
      tenantId: input.tenantId,
      buildingId: input.buildingId,
      period: input.period,
      chargePeriod: input.chargePeriod ?? null,
      baseCurrency: input.baseCurrency,
      totalAmountMinor: input.totalAmountMinor,
      totalsByCurrency: input.totalsByCurrency,
      expenseSnapshot: input.expenseSnapshot,
      unitCount: input.unitCount,
      generatedByMembershipId: input.generatedByMembershipId,
    },
  });

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

    try {
      publishResult = await this.deps.prisma.$transaction(
        async (tx) => {
          const membership = await requireFinanceMembership(
            tx as unknown as FinanceMembershipClient,
            tenantId,
            membershipId,
            this.deps.isAdminOrOperator,
          );

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

          const publicationSnapshot = buildLiquidationPublicationSnapshot({
            liquidationId: current.id,
            tenantId,
            buildingId: current.buildingId,
            period: current.period,
            baseCurrency: current.baseCurrency,
            totalAmountMinor: current.totalAmountMinor,
            totalsByCurrency: parseTotalsByCurrency(current.totalsByCurrency),
            expenses: getPublicationSnapshotExpenses(current.expenseSnapshot),
            allocations: distribution.map((item) => ({
              unitId: item.unitId,
              unitCode: item.unitCode,
              unitLabel: item.unitLabel,
              amountMinor: item.amountMinor,
            })),
            dueDate,
            publishedAt: now,
          });

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
          const expectedCharges = distribution.map((distributionItem) => ({
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
          } else {
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
                chargesCount: distribution.length,
                totalAmountMinor: current.totalAmountMinor,
                baseCurrency: current.baseCurrency,
                snapshotVersion: 1,
                dueDate: dueDate.toISOString().slice(0, 10),
                publishedAt: now.toISOString(),
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

function parseExpenseSnapshot(value: unknown): LiquidationExpenseSnapshotItem[] {
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
