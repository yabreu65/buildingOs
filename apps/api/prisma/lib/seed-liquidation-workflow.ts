import { Prisma, PrismaClient } from '@prisma/client';
import { AuditService } from '../../src/audit/audit.service';
import { FinanzasValidators } from '../../src/finanzas/finanzas.validators';
import { ResidentAccessService } from '../../src/resident-access/resident-access.service';
import {
  buildLiquidationDistributionSnapshot,
  distributeLiquidationMovements,
  type LiquidationDistributionRecipientInput,
} from '../../src/finanzas/liquidation-distribution';
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
  readonly coefficient?: number | null;
  readonly m2?: number | null;
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
  distributionSnapshot: unknown;
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

function sameExpenseSnapshotWithLegacyRecipientEvidence(
  actual: unknown,
  expected: Prisma.InputJsonArray,
): boolean {
  if (sameJson(actual, expected)) {
    return true;
  }

  if (!Array.isArray(actual) || actual.length !== expected.length) {
    return false;
  }

  return actual.every((actualItem, index) => {
    const expectedItem = expected[index];
    if (
      actualItem === null ||
      typeof actualItem !== 'object' ||
      Array.isArray(actualItem) ||
      expectedItem === null ||
      typeof expectedItem !== 'object' ||
      Array.isArray(expectedItem)
    ) {
      return sameJson(actualItem, expectedItem);
    }

    const actualRecord = actualItem as Record<string, unknown>;
    const expectedRecord = expectedItem as Record<string, Prisma.InputJsonValue>;
    if (actualRecord.recipientUnitIds === undefined) {
      const { recipientUnitIds: _recipientUnitIds, ...expectedWithoutRecipientEvidence } = expectedRecord;
      return sameJson(actualRecord, expectedWithoutRecipientEvidence);
    }
    if (expectedRecord.recipientUnitIds === undefined) {
      const { recipientUnitIds: _recipientUnitIds, ...actualWithoutRecipientEvidence } = actualRecord;
      return sameJson(actualWithoutRecipientEvidence, expectedRecord);
    }
    return sameJson(actualRecord, expectedRecord);
  });
}

function stripDistributionSourceEvidence(snapshot: Prisma.InputJsonArray): Prisma.InputJsonArray {
  return snapshot.map((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return item;
    }

    const itemRecord = item as Record<string, Prisma.InputJsonValue>;
    const {
      scopeType: _scopeType,
      unitGroupId: _unitGroupId,
      recipientUnitIds: _recipientUnitIds,
      ...publishedItem
    } = itemRecord;
    return publishedItem;
  }) as Prisma.InputJsonArray;
}

function isP2002(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function countPositiveSnapshotAllocations(snapshot: unknown): number | null {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return null;
  }

  const allocations = (snapshot as Record<string, unknown>).allocations;
  if (!Array.isArray(allocations)) {
    return null;
  }

  return allocations.filter((allocation) => {
    if (allocation === null || typeof allocation !== 'object' || Array.isArray(allocation)) {
      return false;
    }

    const amountMinor = (allocation as Record<string, unknown>).amountMinor;
    return typeof amountMinor === 'number' && amountMinor > 0;
  }).length;
}

function normalizeSnapshotForComparison(snapshot: unknown): Record<string, unknown> | null {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return null;
  }

  const cloned = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
  delete cloned.publishedAt;
  return cloned;
}

async function loadDistributionRecipients(input: SeedLiquidationWorkflowInput): Promise<LiquidationDistributionRecipientInput[]> {
  const unitRows = await input.prisma.unit.findMany({
    where: {
      tenantId: input.tenantId,
      buildingId: input.buildingId,
      isBillable: true,
      id: { in: input.units.map((unit) => unit.id) },
    },
    include: { unitCategory: { select: { coefficient: true } } },
  });
  const rowById = new Map(unitRows.map((unit) => [unit.id, unit]));

  return input.units.map((unit) => {
    const row = rowById.get(unit.id);
    if (!row) {
      throw new Error(`Seed liquidation unit ${unit.id} is not billable in building ${input.buildingId}`);
    }

    return {
      unitId: unit.id,
      unitCode: unit.code,
      unitLabel: unit.label,
      coefficient: unit.coefficient ?? row.unitCategory?.coefficient ?? null,
      m2: unit.m2 ?? row.m2 ?? null,
    };
  });
}

async function loadUnitGroupDistributionRecipients(
  input: SeedLiquidationWorkflowInput,
  unitGroupId: string,
): Promise<LiquidationDistributionRecipientInput[]> {
  const members = await input.prisma.unitGroupMember.findMany({
    where: {
      tenantId: input.tenantId,
      buildingId: input.buildingId,
      unitGroupId,
        unitGroup: {
          tenantId: input.tenantId,
          buildingId: input.buildingId,
        },
        unit: {
          tenantId: input.tenantId,
          buildingId: input.buildingId,
          isBillable: true,
        },
    },
    include: { unit: { include: { unitCategory: { select: { coefficient: true } } } } },
  });
  if (members.length === 0) {
    throw new Error(`Seed liquidation unit group ${unitGroupId} has no billable members in building ${input.buildingId}`);
  }

  return members.map((member) => ({
    unitId: member.unit.id,
    unitCode: member.unit.code,
    unitLabel: member.unit.label,
    coefficient: member.unit.unitCategory?.coefficient ?? null,
    m2: member.unit.m2 ?? null,
  }));
}

export async function ensureSeedPublishedLiquidation(
  input: SeedLiquidationWorkflowInput,
): Promise<SeedWorkflowResult> {
  const validators = new FinanzasValidators(
    input.prisma as never,
    new ResidentAccessService(input.prisma as never),
  );
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

  const buildFrozenDistribution = async () => {
    const buildingRecipients = await loadDistributionRecipients(input);
    const groupRecipients = new Map<string, LiquidationDistributionRecipientInput[]>();
    return distributeLiquidationMovements({
      tenantId: input.tenantId,
      buildingId: input.buildingId,
      totalAmountMinor: input.totalAmountMinor,
      movements: await Promise.all(input.expenseSnapshot.map(async (item, index) => {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) {
          throw new Error(`Seed liquidation expense snapshot item ${index} is invalid`);
        }
        const snapshot = item as Record<string, Prisma.InputJsonValue>;
        const movementId = snapshot.expenseId;
        const amountMinor = snapshot.amountMinor;
        const scope = snapshot.scopeType;
        const unitGroupId = snapshot.unitGroupId;
        const normalizedUnitGroupId = typeof unitGroupId === 'string' ? unitGroupId : null;
        if (
          typeof movementId !== 'string' ||
          typeof amountMinor !== 'number' ||
          !Number.isSafeInteger(amountMinor) ||
          amountMinor < 0 ||
          (scope !== 'BUILDING' && scope !== 'UNIT_GROUP' && scope !== 'ADJUSTMENT') ||
          (unitGroupId !== null && unitGroupId !== undefined && typeof unitGroupId !== 'string') ||
          (scope === 'UNIT_GROUP' && normalizedUnitGroupId === null) ||
          (scope !== 'UNIT_GROUP' && normalizedUnitGroupId !== null)
        ) {
          throw new Error(`Seed liquidation expense snapshot item ${index} is invalid`);
        }

        let recipients = buildingRecipients;
        if (scope === 'UNIT_GROUP') {
          if (normalizedUnitGroupId === null) {
            throw new Error(`Seed liquidation expense snapshot item ${index} is invalid`);
          }
          recipients = groupRecipients.get(normalizedUnitGroupId) ??
            await loadUnitGroupDistributionRecipients(input, normalizedUnitGroupId);
          groupRecipients.set(normalizedUnitGroupId, recipients);
        }

        return {
          movementId,
          scope,
          unitGroupId: normalizedUnitGroupId,
          amountMinor,
          recipients,
        };
      })),
    });
  };
  const bindRecipientEvidence = (
    frozenDistribution: Awaited<ReturnType<typeof buildFrozenDistribution>>,
  ): Prisma.InputJsonArray => {
    const recipientUnitIdsByMovementId = new Map(
      frozenDistribution.movements
        .filter(
          (movement) =>
            movement.scope === 'UNIT_GROUP' ||
            movement.scope === 'BUILDING' ||
            movement.scope === 'ADJUSTMENT',
        )
        .map((movement) => [movement.movementId, movement.recipientUnitIds]),
    );

    return input.expenseSnapshot.map((item, index) => {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`Seed liquidation expense snapshot item ${index} is invalid`);
      }

      const snapshot = item as Record<string, Prisma.InputJsonValue>;
      if (
        snapshot.scopeType !== 'UNIT_GROUP' &&
        snapshot.scopeType !== 'BUILDING' &&
        snapshot.scopeType !== 'ADJUSTMENT'
      ) {
        return snapshot as Prisma.InputJsonObject;
      }
      if (
        typeof snapshot.expenseId !== 'string' ||
        (snapshot.scopeType === 'UNIT_GROUP' &&
          (typeof snapshot.unitGroupId !== 'string' || snapshot.unitGroupId.trim().length === 0))
      ) {
        throw new Error(`Seed liquidation expense snapshot item ${index} is invalid`);
      }

      const recipientUnitIds = recipientUnitIdsByMovementId.get(snapshot.expenseId);
      if (!recipientUnitIds) {
        throw new Error(`Seed liquidation expense snapshot item ${index} is invalid`);
      }

      return {
        ...snapshot,
        recipientUnitIds: [...recipientUnitIds].sort(),
      } as Prisma.InputJsonObject;
    }) as Prisma.InputJsonArray;
  };

  let expectedDraftExpenseSnapshot = input.expenseSnapshot;
  let expectedUnitCount = input.units.length;
  const expectedUnitCountFor = (liquidation: ActiveLiquidationRecord | null): number =>
    countPositiveSnapshotAllocations(liquidation?.distributionSnapshot) ??
    countPositiveSnapshotAllocations(liquidation?.publicationSnapshot) ??
    input.units.length;
  const expectedPublishedSnapshotBase = (): Record<string, unknown> => ({
    version: 1,
    liquidationId: '',
    tenantId: input.tenantId,
    buildingId: input.buildingId,
    period: input.period,
    baseCurrency: input.baseCurrency,
    totalAmountMinor: input.totalAmountMinor,
    totalsByCurrency: input.totalsByCurrency,
    expenses: stripDistributionSourceEvidence(expectedDraftExpenseSnapshot),
    allocations: undefined,
    dueDate: input.dueDate.toISOString(),
  });

  const validateCompatible = async (liquidation: ActiveLiquidationRecord): Promise<void> => {
    const isLegacyDistribution =
      liquidation.distributionSnapshot === null || liquidation.distributionSnapshot === undefined;
    const expectedExpenseSnapshot = isLegacyDistribution
      ? stripDistributionSourceEvidence(expectedDraftExpenseSnapshot)
      : expectedDraftExpenseSnapshot;
    const actualExpenseSnapshot = isLegacyDistribution && Array.isArray(liquidation.expenseSnapshot)
      ? stripDistributionSourceEvidence(liquidation.expenseSnapshot as Prisma.InputJsonArray)
      : liquidation.expenseSnapshot;

    if (
      liquidation.baseCurrency !== input.baseCurrency ||
      liquidation.totalAmountMinor !== input.totalAmountMinor ||
      liquidation.unitCount !== expectedUnitCount ||
      liquidation.chargePeriod !== (input.chargePeriod ?? null) ||
      !sameJson(liquidation.totalsByCurrency, input.totalsByCurrency) ||
      !sameExpenseSnapshotWithLegacyRecipientEvidence(
        actualExpenseSnapshot,
        expectedExpenseSnapshot,
      )
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

    const publicationSnapshot = normalizeSnapshotForComparison(liquidation.publicationSnapshot);
    if (!publicationSnapshot) {
      throw new Error(`Seed liquidation ${liquidation.id} is missing publicationSnapshot`);
    }

    if (
      publicationSnapshot.tenantId !== expectedPublishedSnapshotBase().tenantId ||
      publicationSnapshot.buildingId !== expectedPublishedSnapshotBase().buildingId ||
      publicationSnapshot.period !== expectedPublishedSnapshotBase().period ||
      publicationSnapshot.baseCurrency !== expectedPublishedSnapshotBase().baseCurrency ||
      publicationSnapshot.totalAmountMinor !== expectedPublishedSnapshotBase().totalAmountMinor ||
      !sameJson(publicationSnapshot.totalsByCurrency, expectedPublishedSnapshotBase().totalsByCurrency) ||
      !sameJson(publicationSnapshot.expenses, expectedPublishedSnapshotBase().expenses) ||
      publicationSnapshot.dueDate !== expectedPublishedSnapshotBase().dueDate
    ) {
      throw new Error(
        `Seed liquidation ${liquidation.id} publication snapshot does not match expected invariants`,
      );
    }

    const allocations = Array.isArray(publicationSnapshot.allocations)
      ? publicationSnapshot.allocations
      : null;

    const payableAllocations = allocations?.filter((allocation) => {
      const row = allocation as { amountMinor?: unknown };
      return typeof row.amountMinor === 'number' && row.amountMinor > 0;
    });
    if (!allocations || !payableAllocations || payableAllocations.length !== charges.length) {
      throw new Error(
        `Seed liquidation ${liquidation.id} has ${charges.length} charges but ${payableAllocations?.length ?? 0} payable published allocations were expected`,
      );
    }

    const expectedByUnit = new Map<string, number>();
    for (const allocation of allocations) {
      const row = allocation as {
        unitId?: unknown;
        amountMinor?: unknown;
      };
      if (
        typeof row.unitId !== 'string' ||
        row.unitId.trim().length === 0 ||
        typeof row.amountMinor !== 'number' ||
        !Number.isSafeInteger(row.amountMinor) ||
        row.amountMinor < 0 ||
        expectedByUnit.has(row.unitId)
      ) {
        throw new Error(
          `Seed liquidation ${liquidation.id} publication snapshot allocations are invalid`,
        );
      }
      if (row.amountMinor > 0) {
        expectedByUnit.set(row.unitId, row.amountMinor);
      }
    }

    const chargeUnitIds = new Set<string>();
    for (const charge of charges) {
      if (
        chargeUnitIds.has(charge.unitId) ||
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
      chargeUnitIds.add(charge.unitId);
    }
  };

  let liquidation = await findActive();
  let created = false;
  expectedUnitCount = expectedUnitCountFor(liquidation);

  if (!liquidation) {
    const frozenDistribution = await buildFrozenDistribution();
    expectedUnitCount = frozenDistribution.allocations.filter(
      (allocation) => allocation.amountMinor > 0,
    ).length;
    expectedDraftExpenseSnapshot = bindRecipientEvidence(frozenDistribution);
    try {
      liquidation = await input.prisma.$transaction((tx) =>
        createLiquidationDraftRecord(tx, {
          createAuditLogRequired: (payload, client) => auditService.createLogRequired(payload, client),
        }, {
          tenantId: input.tenantId,
          buildingId: input.buildingId,
          period: input.period,
          chargePeriod: input.chargePeriod ?? null,
          publicationIntegrityVersion: 1,
          valuationMode: 'LEGACY_NOMINAL',
          baseCurrency: input.baseCurrency,
          totalAmountMinor: input.totalAmountMinor,
          totalsByCurrency: input.totalsByCurrency,
          expenseSnapshot: expectedDraftExpenseSnapshot,
          grossExpenseAmountMinor: input.totalAmountMinor,
          adjustmentAmountMinor: 0,
          preIncomeAmountMinor: input.totalAmountMinor,
          incomeOffsetAmountMinor: 0,
          netDistributableAmountMinor: input.totalAmountMinor,
          unitCount: expectedUnitCount,
          generatedByMembershipId: membership.id,
          distributionSnapshot: buildLiquidationDistributionSnapshot(frozenDistribution),
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
      expectedUnitCount = expectedUnitCountFor(liquidation);
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
  readonly scopeType?: 'BUILDING' | 'UNIT_GROUP' | 'ADJUSTMENT';
  readonly unitGroupId?: string | null;
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
    scopeType: input.scopeType ?? (input.type === 'ADJUSTMENT' ? 'ADJUSTMENT' : 'BUILDING'),
    unitGroupId: input.unitGroupId ?? null,
    ...(input.sourcePeriod ? { sourcePeriod: input.sourcePeriod } : {}),
  };
}
