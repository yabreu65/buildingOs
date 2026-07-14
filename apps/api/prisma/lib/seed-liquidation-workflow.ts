import { Prisma, PrismaClient } from '@prisma/client';
import { AuditService } from '../../src/audit/audit.service';
import { FinanzasValidators } from '../../src/finanzas/finanzas.validators';
import {
  createLiquidationDraftRecord,
  LiquidationPublicationUseCase,
  requireFinanceMembership,
  reviewLiquidationRecord,
  type LiquidationExpenseSnapshotItem,
  type NotificationPolicy,
} from '../../src/finanzas/liquidation-publication.use-case';

interface WorkflowUnitRecord {
  readonly id: string;
  readonly code: string;
  readonly label: string | null;
}

interface SeedLiquidationWorkflowInput {
  readonly prisma: PrismaClient;
  readonly tenantId: string;
  readonly buildingId: string;
  readonly membershipId: string;
  readonly period: string;
  readonly chargePeriod?: string | null;
  readonly baseCurrency: string;
  readonly totalAmountMinor: number;
  readonly totalsByCurrency: Prisma.InputJsonObject;
  readonly expenseSnapshot: Prisma.InputJsonArray;
  readonly units: ReadonlyArray<WorkflowUnitRecord>;
  readonly dueDate: Date;
  readonly notificationPolicy?: NotificationPolicy;
}

interface SeedWorkflowResult {
  readonly id: string;
  readonly created: boolean;
  readonly status: 'PUBLISHED';
}

interface ActiveLiquidationRecord {
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
  generatedByMembershipId: string;
  generatedAt: Date;
  reviewedAt: Date | null;
  publishedAt: Date | null;
  canceledAt: Date | null;
  createdAt: Date;
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJson(item));
  }

  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = normalizeJson((value as Record<string, unknown>)[key]);
        return accumulator;
      }, {});
  }

  return value;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeJson(left)) === JSON.stringify(normalizeJson(right));
}

function isP2002(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function normalizeSnapshotForComparison(snapshot: unknown): Record<string, unknown> | null {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return null;
  }

  const cloned = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
  delete cloned.publishedAt;
  return cloned;
}

export async function ensureSeedPublishedLiquidation(
  input: SeedLiquidationWorkflowInput,
): Promise<SeedWorkflowResult> {
  const validators = new FinanzasValidators(input.prisma as never);
  const auditService = new AuditService(input.prisma as never);
  const publicationUseCase = new LiquidationPublicationUseCase({
    prisma: input.prisma as never,
    isAdminOrOperator: (roles) => validators.isAdminOrOperator(roles),
    createAuditLogRequired: (payload, tx) => auditService.createLogRequired(payload, tx),
    createAuditLog: (payload) => auditService.createLog(payload),
    toPublishedLiquidationDto: (liquidation) => ({
      id: liquidation.id,
      tenantId: liquidation.tenantId,
      buildingId: liquidation.buildingId,
      period: liquidation.period,
      chargePeriod: liquidation.chargePeriod,
      status: liquidation.status,
      baseCurrency: liquidation.baseCurrency,
      totalAmountMinor: liquidation.totalAmountMinor,
      totalsByCurrency: liquidation.totalsByCurrency as Record<string, number>,
      unitCount: liquidation.unitCount,
      generatedAt: liquidation.generatedAt,
      reviewedAt: liquidation.reviewedAt,
      publishedAt: liquidation.publishedAt,
      canceledAt: liquidation.canceledAt,
      createdAt: liquidation.createdAt,
    }),
    sendChargePublishedNotifications: async () => ({
      sentCount: 0,
      failedCount: 0,
      errorMessages: [],
    }),
  });

  const membership = await requireFinanceMembership(
    input.prisma as never,
    input.tenantId,
    input.membershipId,
    (roles) => validators.isAdminOrOperator(roles),
  );

  const findActive = async (): Promise<ActiveLiquidationRecord | null> =>
    input.prisma.liquidation.findFirst({
      where: {
        tenantId: input.tenantId,
        buildingId: input.buildingId,
        period: input.period,
        status: { not: 'CANCELED' },
      },
    }) as Promise<ActiveLiquidationRecord | null>;

  const expectedDraftExpenseSnapshot = input.expenseSnapshot;
  const expectedPublishedSnapshotBase = {
    version: 1,
    liquidationId: '',
    tenantId: input.tenantId,
    buildingId: input.buildingId,
    period: input.period,
    baseCurrency: input.baseCurrency,
    totalAmountMinor: input.totalAmountMinor,
    totalsByCurrency: input.totalsByCurrency,
    expenses: expectedDraftExpenseSnapshot,
    allocations: undefined,
    dueDate: input.dueDate.toISOString(),
  };

  const validateCompatible = async (liquidation: ActiveLiquidationRecord): Promise<void> => {
    if (
      liquidation.baseCurrency !== input.baseCurrency ||
      liquidation.totalAmountMinor !== input.totalAmountMinor ||
      liquidation.unitCount !== input.units.length ||
      liquidation.chargePeriod !== (input.chargePeriod ?? null) ||
      !sameJson(liquidation.totalsByCurrency, input.totalsByCurrency) ||
      !sameJson(liquidation.expenseSnapshot, expectedDraftExpenseSnapshot)
    ) {
      throw new Error(
        `Seed liquidation ${liquidation.id} exists but does not match expected invariants`,
      );
    }

    if (liquidation.status !== 'PUBLISHED') {
      return;
    }

    const charges = await input.prisma.charge.findMany({
      where: {
        tenantId: input.tenantId,
        liquidationId: liquidation.id,
        buildingId: input.buildingId,
        period: input.period,
      },
      orderBy: { unitId: 'asc' },
      select: {
        unitId: true,
        amount: true,
        currency: true,
        concept: true,
        dueDate: true,
        period: true,
        buildingId: true,
        liquidationId: true,
      },
    });

    if (charges.length !== input.units.length) {
      throw new Error(
        `Seed liquidation ${liquidation.id} has ${charges.length} charges but ${input.units.length} were expected`,
      );
    }

    const publicationSnapshot = normalizeSnapshotForComparison(liquidation.publicationSnapshot);
    if (!publicationSnapshot) {
      throw new Error(`Seed liquidation ${liquidation.id} is missing publicationSnapshot`);
    }

    if (
      publicationSnapshot.tenantId !== expectedPublishedSnapshotBase.tenantId ||
      publicationSnapshot.buildingId !== expectedPublishedSnapshotBase.buildingId ||
      publicationSnapshot.period !== expectedPublishedSnapshotBase.period ||
      publicationSnapshot.baseCurrency !== expectedPublishedSnapshotBase.baseCurrency ||
      publicationSnapshot.totalAmountMinor !== expectedPublishedSnapshotBase.totalAmountMinor ||
      !sameJson(publicationSnapshot.totalsByCurrency, expectedPublishedSnapshotBase.totalsByCurrency) ||
      !sameJson(publicationSnapshot.expenses, expectedPublishedSnapshotBase.expenses) ||
      publicationSnapshot.dueDate !== expectedPublishedSnapshotBase.dueDate
    ) {
      throw new Error(
        `Seed liquidation ${liquidation.id} publication snapshot does not match expected invariants`,
      );
    }

    const allocations = Array.isArray(publicationSnapshot.allocations)
      ? publicationSnapshot.allocations
      : null;

    if (!allocations || allocations.length !== charges.length) {
      throw new Error(
        `Seed liquidation ${liquidation.id} publication snapshot allocations do not match expected charges`,
      );
    }

    const expectedByUnit = new Map(
      allocations.map((allocation) => {
        const row = allocation as {
          unitId?: string;
          amountMinor?: number;
        };
        return [row.unitId, row.amountMinor];
      }),
    );

    for (const charge of charges) {
      if (
        charge.currency !== input.baseCurrency ||
        charge.buildingId !== input.buildingId ||
        charge.period !== input.period ||
        charge.liquidationId !== liquidation.id ||
        charge.concept !== `Expensas comunes ${input.period}` ||
        charge.dueDate.toISOString() !== input.dueDate.toISOString() ||
        expectedByUnit.get(charge.unitId) !== charge.amount
      ) {
        throw new Error(
          `Seed liquidation ${liquidation.id} has charges that do not match the published snapshot`,
        );
      }
    }
  };

  let liquidation = await findActive();
  let created = false;

  if (!liquidation) {
    try {
      liquidation = await input.prisma.$transaction((tx) =>
        createLiquidationDraftRecord(tx, {
          createAuditLogRequired: (payload, client) => auditService.createLogRequired(payload, client),
        }, {
          tenantId: input.tenantId,
          buildingId: input.buildingId,
          period: input.period,
          chargePeriod: input.chargePeriod ?? null,
          baseCurrency: input.baseCurrency,
          totalAmountMinor: input.totalAmountMinor,
          totalsByCurrency: input.totalsByCurrency,
          expenseSnapshot: expectedDraftExpenseSnapshot,
          unitCount: input.units.length,
          generatedByMembershipId: membership.id,
        }),
      ) as unknown as ActiveLiquidationRecord;
      created = true;
    } catch (error) {
      if (!isP2002(error)) {
        throw error;
      }

      liquidation = await findActive();
      if (!liquidation) {
        throw error;
      }
    }
  }

  if (!liquidation) {
    throw new Error(
      `Seed liquidation ${input.tenantId}/${input.buildingId}/${input.period} could not be loaded`,
    );
  }

  let currentLiquidation = liquidation;
  await validateCompatible(currentLiquidation);

  if (currentLiquidation.status === 'DRAFT') {
    currentLiquidation = await input.prisma.$transaction((tx) =>
      reviewLiquidationRecord(tx, {
        createAuditLogRequired: (payload, client) => auditService.createLogRequired(payload, client),
      }, {
        tenantId: input.tenantId,
        liquidationId: currentLiquidation.id,
        membershipId: membership.id,
      }),
    ) as unknown as ActiveLiquidationRecord;
    liquidation = currentLiquidation;
  }

  if (currentLiquidation.status === 'REVIEWED') {
    await publicationUseCase.execute(
      input.tenantId,
      currentLiquidation.id,
      membership.id,
      { dueDate: input.dueDate.toISOString() },
      input.notificationPolicy ?? 'disabled',
    );
    liquidation = await findActive();
    if (!liquidation) {
      throw new Error(`Seed liquidation ${input.tenantId}/${input.buildingId}/${input.period} disappeared after publish`);
    }
    currentLiquidation = liquidation;
  }

  await validateCompatible(currentLiquidation);

  if (currentLiquidation.status !== 'PUBLISHED') {
    throw new Error(`Seed liquidation ${currentLiquidation.id} has unsupported status ${currentLiquidation.status}`);
  }

  return {
    id: currentLiquidation.id,
    created,
    status: 'PUBLISHED',
  };
}

export function buildSeedExpenseSnapshotItem(input: {
  readonly expenseId: string;
  readonly categoryName: string;
  readonly vendorName?: string | null;
  readonly amountMinor: number;
  readonly currencyCode: string;
  readonly invoiceDate: Date;
  readonly description?: string | null;
  readonly type?: 'EXPENSE' | 'ADJUSTMENT';
  readonly sourcePeriod?: string;
}): LiquidationExpenseSnapshotItem {
  return {
    expenseId: input.expenseId,
    categoryName: input.categoryName,
    vendorName: input.vendorName ?? null,
    amountMinor: input.amountMinor,
    currencyCode: input.currencyCode,
    invoiceDate: input.invoiceDate.toISOString(),
    description: input.description ?? null,
    type: input.type ?? 'EXPENSE',
    ...(input.sourcePeriod ? { sourcePeriod: input.sourcePeriod } : {}),
  };
}
