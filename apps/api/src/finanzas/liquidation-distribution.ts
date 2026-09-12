import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type LiquidationDistributionScope = 'BUILDING' | 'UNIT_GROUP' | 'ADJUSTMENT';
export type LiquidationDistributionWeightSource = 'COEFFICIENT' | 'M2' | 'EQUAL';

export interface LiquidationDistributionRecipientInput {
  readonly unitId: string;
  readonly unitCode: string;
  readonly unitLabel: string | null;
  readonly coefficient: number | null;
  readonly m2: number | null;
}

export interface LiquidationDistributionMovementInput {
  readonly movementId: string;
  readonly scope: LiquidationDistributionScope;
  readonly unitGroupId?: string | null;
  readonly amountMinor: number;
  readonly recipients: readonly LiquidationDistributionRecipientInput[];
}

export interface LiquidationDistributionInput {
  readonly tenantId: string;
  readonly buildingId: string;
  readonly totalAmountMinor: number;
  readonly movements: readonly LiquidationDistributionMovementInput[];
}

export interface LiquidationDistributionAllocation {
  readonly unitId: string;
  readonly unitCode: string;
  readonly unitLabel: string | null;
  readonly amountMinor: number;
}

export interface LiquidationDistributionSnapshotRecipient {
  readonly unitId: string;
  readonly unitCode: string;
  readonly unitLabel: string | null;
  readonly coefficient: string | null;
  readonly m2: string | null;
  readonly weight: string;
}

export interface LiquidationDistributionSnapshotMovement {
  readonly movementId: string;
  readonly scope: LiquidationDistributionScope;
  readonly unitGroupId: string | null;
  readonly amountMinor: number;
  readonly weightSource: LiquidationDistributionWeightSource;
  readonly totalWeight: string;
  readonly recipientUnitIds: readonly string[];
  readonly recipients: readonly LiquidationDistributionSnapshotRecipient[];
  readonly allocations: readonly LiquidationDistributionAllocation[];
}

export interface LiquidationDistributionSnapshotV1 {
  readonly version: 1;
  readonly tenantId: string;
  readonly buildingId: string;
  readonly totalAmountMinor: number;
  readonly movements: readonly LiquidationDistributionSnapshotMovement[];
  readonly allocations: readonly LiquidationDistributionAllocation[];
}

export interface LiquidationDistributionResult extends LiquidationDistributionSnapshotV1 {}

interface NormalizedRecipient extends LiquidationDistributionSnapshotRecipient {
  readonly coefficientDecimal: Prisma.Decimal | null;
  readonly m2Decimal: Prisma.Decimal | null;
}

interface MovementWeight {
  readonly movement: LiquidationDistributionMovementInput;
  readonly amount: Prisma.Decimal;
}

/**
 * Allocates the already-valued liquidation movements using only Prisma.Decimal.
 * The total may be lower than the source sum because income offsets remain a
 * liquidation-level operation; their effect is apportioned across source
 * movements before each movement is distributed to its frozen recipients.
 */
export function distributeLiquidationMovements(
  input: LiquidationDistributionInput,
): LiquidationDistributionResult {
  assertNonEmptyString(input.tenantId, 'tenantId');
  assertNonEmptyString(input.buildingId, 'buildingId');
  assertMinorAmount(input.totalAmountMinor, 'totalAmountMinor');

  if (input.movements.length === 0) {
    if (input.totalAmountMinor === 0) {
      return {
        version: 1,
        tenantId: input.tenantId,
        buildingId: input.buildingId,
        totalAmountMinor: 0,
        movements: [],
        allocations: [],
      };
    }
    throw invalid('requires source movements for a positive total');
  }

  const movementWeights = input.movements.map((movement) => {
    assertNonEmptyString(movement.movementId, 'movementId');
    if (!isDistributionScope(movement.scope)) {
      throw invalid('has an invalid movement scope');
    }
    if (movement.scope === 'UNIT_GROUP') {
      assertNonEmptyString(movement.unitGroupId, `movement ${movement.movementId}.unitGroupId`);
    } else if (movement.unitGroupId !== undefined && movement.unitGroupId !== null) {
      throw invalid(`movement ${movement.movementId} has an unexpected unitGroupId`);
    }
    assertMinorAmount(movement.amountMinor, `movement ${movement.movementId}.amountMinor`);
    if (movement.recipients.length === 0) {
      throw invalid(`movement ${movement.movementId} has no recipients`);
    }
    return { movement, amount: new Prisma.Decimal(movement.amountMinor) };
  });

  const sourceTotal = movementWeights.reduce(
    (sum, movement) => sum.plus(movement.amount),
    new Prisma.Decimal(0),
  );
  const requestedTotal = new Prisma.Decimal(input.totalAmountMinor);
  if (requestedTotal.greaterThan(sourceTotal)) {
    throw invalid('total exceeds the valued source movements');
  }

  const movementAmounts = allocateMinorByDecimalWeights(
    movementWeights.map((movement) => ({
      id: movement.movement.movementId,
      weight: movement.amount,
    })),
    input.totalAmountMinor,
    'movements',
  );

  const allocationsByUnitId = new Map<string, LiquidationDistributionAllocation>();
  const movements = movementWeights.map(({ movement }) => {
    const normalizedRecipients = movement.recipients.map(normalizeRecipient);
    assertUniqueIds(normalizedRecipients.map((recipient) => recipient.unitId), 'recipient unitId');
    const { weightSource, weights } = resolveRecipientWeights(normalizedRecipients);
    const amountMinor = movementAmounts.get(movement.movementId);
    if (amountMinor === undefined) {
      throw invalid(`movement ${movement.movementId} amount is missing`);
    }

    const allocations = allocateMinorByDecimalWeights(
      weights.map(({ recipient, weight }) => ({ id: recipient.unitId, weight })),
      amountMinor,
      `movement ${movement.movementId}`,
    ).entries();
    const recipientById = new Map(normalizedRecipients.map((recipient) => [recipient.unitId, recipient]));
    const movementAllocations = [...allocations]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([unitId, allocatedMinor]) => {
        const recipient = recipientById.get(unitId);
        if (!recipient) {
          throw invalid(`movement ${movement.movementId} recipient is missing`);
        }
        const allocation: LiquidationDistributionAllocation = {
          unitId,
          unitCode: recipient.unitCode,
          unitLabel: recipient.unitLabel,
          amountMinor: allocatedMinor,
        };
        const existing = allocationsByUnitId.get(unitId);
        allocationsByUnitId.set(unitId, {
          ...allocation,
          amountMinor: safeAdd(existing?.amountMinor ?? 0, allocatedMinor, 'allocation total'),
        });
        return allocation;
      });

    const totalWeight = weights.reduce(
      (sum, item) => sum.plus(item.weight),
      new Prisma.Decimal(0),
    );

    return {
      movementId: movement.movementId,
      scope: movement.scope,
      unitGroupId: movement.unitGroupId ?? null,
      amountMinor,
      weightSource,
      totalWeight: totalWeight.toString(),
      recipientUnitIds: normalizedRecipients.map((recipient) => recipient.unitId).sort(),
      recipients: weights
        .slice()
        .sort((left, right) => left.recipient.unitId.localeCompare(right.recipient.unitId))
        .map(({ recipient, weight }) => ({
          unitId: recipient.unitId,
          unitCode: recipient.unitCode,
          unitLabel: recipient.unitLabel,
          coefficient: recipient.coefficient,
          m2: recipient.m2,
          weight: weight.toString(),
        })),
      allocations: movementAllocations,
    };
  });

  const allocations = [...allocationsByUnitId.values()].sort((left, right) =>
    left.unitId.localeCompare(right.unitId),
  );
  const reconciledTotal = allocations.reduce(
    (sum, allocation) => safeAdd(sum, allocation.amountMinor, 'allocation total'),
    0,
  );
  if (reconciledTotal !== input.totalAmountMinor) {
    throw invalid('allocations do not reconcile to the liquidation total');
  }

  return {
    version: 1,
    tenantId: input.tenantId,
    buildingId: input.buildingId,
    totalAmountMinor: input.totalAmountMinor,
    movements,
    allocations,
  };
}

export function buildLiquidationDistributionSnapshot(
  distribution: LiquidationDistributionResult,
): Prisma.InputJsonObject {
  const snapshot = parseLiquidationDistributionSnapshot(distribution);
  return snapshot as unknown as Prisma.InputJsonObject;
}

export function parseLiquidationDistributionSnapshot(
  value: unknown,
): LiquidationDistributionSnapshotV1 {
  if (!isPlainObject(value) || value.version !== 1) {
    throw invalid('snapshot version is invalid');
  }

  const tenantId = requiredString(value.tenantId, 'snapshot tenantId');
  const buildingId = requiredString(value.buildingId, 'snapshot buildingId');
  const totalAmountMinor = requiredMinor(value.totalAmountMinor, 'snapshot totalAmountMinor');
  if (!Array.isArray(value.movements) || !Array.isArray(value.allocations)) {
    throw invalid('snapshot movements or allocations are invalid');
  }

  const movements = value.movements.map((movement, index) =>
    parseSnapshotMovement(movement, `snapshot movement ${index}`),
  );
  assertUniqueIds(movements.map((movement) => movement.movementId), 'snapshot movementId');
  const allocations = value.allocations.map((allocation, index) =>
    parseAllocation(allocation, `snapshot allocation ${index}`),
  );
  assertUniqueIds(allocations.map((allocation) => allocation.unitId), 'snapshot allocation unitId');

  const movementTotal = movements.reduce(
    (sum, movement) => safeAdd(sum, movement.amountMinor, 'snapshot movement total'),
    0,
  );
  if (movementTotal !== totalAmountMinor) {
    throw invalid('snapshot movements do not reconcile to the liquidation total');
  }
  const allocationTotal = allocations.reduce(
    (sum, allocation) => safeAdd(sum, allocation.amountMinor, 'snapshot allocation total'),
    0,
  );
  if (allocationTotal !== totalAmountMinor) {
    throw invalid('snapshot allocations do not reconcile to the liquidation total');
  }
  if (totalAmountMinor > 0 && allocations.length === 0) {
    throw invalid('snapshot requires allocations for a positive total');
  }

  const recalculatedAllocations = new Map<string, number>();
  for (const movement of movements) {
    const recipientIds = movement.recipients.map((recipient) => recipient.unitId).sort();
    if (recipientIds.join('|') !== [...movement.recipientUnitIds].sort().join('|')) {
      throw invalid(`snapshot movement ${movement.movementId} recipient population is inconsistent`);
    }
    const movementAllocationTotal = movement.allocations.reduce(
      (sum, allocation) => safeAdd(sum, allocation.amountMinor, 'snapshot movement allocation total'),
      0,
    );
    if (movementAllocationTotal !== movement.amountMinor) {
      throw invalid(`snapshot movement ${movement.movementId} allocations are inconsistent`);
    }
    for (const allocation of movement.allocations) {
      if (!recipientIds.includes(allocation.unitId)) {
        throw invalid(`snapshot movement ${movement.movementId} allocation recipient is invalid`);
      }
      recalculatedAllocations.set(
        allocation.unitId,
        safeAdd(recalculatedAllocations.get(allocation.unitId) ?? 0, allocation.amountMinor, 'snapshot allocation total'),
      );
    }
  }

  const allocationsById = new Map(allocations.map((allocation) => [allocation.unitId, allocation]));
  if (
    recalculatedAllocations.size !== allocationsById.size ||
    ![...recalculatedAllocations].every(([unitId, amountMinor]) =>
      allocationsById.get(unitId)?.amountMinor === amountMinor,
    )
  ) {
    throw invalid('snapshot final allocations do not match movement allocations');
  }

  return {
    version: 1,
    tenantId,
    buildingId,
    totalAmountMinor,
    movements,
    allocations,
  };
}

export function validateFrozenLiquidationDistributionSnapshot(
  value: unknown,
  expected: { readonly tenantId: string; readonly buildingId: string; readonly totalAmountMinor: number },
): LiquidationDistributionSnapshotV1 {
  const snapshot = parseLiquidationDistributionSnapshot(value);
  if (
    snapshot.tenantId !== expected.tenantId ||
    snapshot.buildingId !== expected.buildingId ||
    snapshot.totalAmountMinor !== expected.totalAmountMinor
  ) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'LIQUIDATION_DISTRIBUTION_SNAPSHOT_INVALID',
      message: 'El snapshot de distribución congelada no corresponde a la liquidación; no se publica',
    });
  }
  return snapshot;
}

function allocateMinorByDecimalWeights(
  values: readonly { readonly id: string; readonly weight: Prisma.Decimal }[],
  totalAmountMinor: number,
  context: string,
): Map<string, number> {
  assertMinorAmount(totalAmountMinor, `${context}.totalAmountMinor`);
  assertUniqueIds(values.map((value) => value.id), `${context} weight id`);
  const totalWeight = values.reduce((sum, value) => {
    if (value.weight.isNegative() || !value.weight.isFinite()) {
      throw invalid(`${context} has an invalid weight`);
    }
    return sum.plus(value.weight);
  }, new Prisma.Decimal(0));
  if (totalWeight.isZero()) {
    throw invalid(`${context} weights must have a positive sum`);
  }

  const ranked = values.map((value) => {
    const exact = new Prisma.Decimal(totalAmountMinor).mul(value.weight).div(totalWeight);
    const rounded = exact.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_EVEN);
    const amountMinor = decimalToMinor(rounded, `${context} allocation`);
    return { ...value, exact, amountMinor, residual: exact.minus(rounded) };
  });
  const roundedTotal = ranked.reduce(
    (sum, allocation) => safeAdd(sum, allocation.amountMinor, `${context} allocation total`),
    0,
  );
  let delta = totalAmountMinor - roundedTotal;
  const ordered = ranked.slice().sort((left, right) => {
    const residualComparison = delta >= 0
      ? right.residual.comparedTo(left.residual)
      : left.residual.comparedTo(right.residual);
    return residualComparison !== 0 ? residualComparison : left.id.localeCompare(right.id);
  });

  while (delta !== 0) {
    let changed = false;
    for (const allocation of ordered) {
      if (delta === 0) break;
      if (delta < 0 && allocation.amountMinor === 0) continue;
      allocation.amountMinor += delta > 0 ? 1 : -1;
      delta += delta > 0 ? -1 : 1;
      changed = true;
    }
    if (!changed) {
      throw invalid(`${context} residual cannot be reconciled`);
    }
  }

  const finalTotal = ranked.reduce(
    (sum, allocation) => safeAdd(sum, allocation.amountMinor, `${context} allocation total`),
    0,
  );
  if (finalTotal !== totalAmountMinor) {
    throw invalid(`${context} allocations do not reconcile`);
  }
  return new Map(ranked.map((allocation) => [allocation.id, allocation.amountMinor]));
}

function resolveRecipientWeights(recipients: readonly NormalizedRecipient[]): {
  readonly weightSource: LiquidationDistributionWeightSource;
  readonly weights: Array<{ readonly recipient: NormalizedRecipient; readonly weight: Prisma.Decimal }>;
} {
  const positiveCoefficients = recipients.filter(
    (recipient) => recipient.coefficientDecimal?.greaterThan(0) === true,
  );
  if (positiveCoefficients.length > 0) {
    return {
      weightSource: 'COEFFICIENT',
      // Preserve the established resolver: a missing or non-positive coefficient
      // receives the neutral weight 1 rather than changing the building policy.
      weights: recipients.map((recipient) => ({
        recipient,
        weight: recipient.coefficientDecimal?.greaterThan(0)
          ? recipient.coefficientDecimal
          : new Prisma.Decimal(1),
      })),
    };
  }

  return {
    weightSource: 'EQUAL',
    weights: recipients.map((recipient) => ({ recipient, weight: new Prisma.Decimal(1) })),
  };
}

function normalizeRecipient(value: LiquidationDistributionRecipientInput): NormalizedRecipient {
  assertNonEmptyString(value.unitId, 'recipient unitId');
  assertNonEmptyString(value.unitCode, 'recipient unitCode');
  if (value.unitLabel !== null && (typeof value.unitLabel !== 'string' || value.unitLabel.trim() === '')) {
    throw invalid('recipient unitLabel is invalid');
  }
  const coefficientDecimal = normalizeFloatDecimal(value.coefficient, 'recipient coefficient');
  const m2Decimal = normalizeFloatDecimal(value.m2, 'recipient m2');
  return {
    unitId: value.unitId,
    unitCode: value.unitCode,
    unitLabel: value.unitLabel,
    coefficient: coefficientDecimal?.toString() ?? null,
    m2: m2Decimal?.toString() ?? null,
    weight: '',
    coefficientDecimal,
    m2Decimal,
  };
}

function normalizeFloatDecimal(value: number | null, field: string): Prisma.Decimal | null {
  if (value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    Math.abs(value) > Number.MAX_SAFE_INTEGER
  ) {
    throw invalid(`${field} is invalid`);
  }
  try {
    return new Prisma.Decimal(value.toString());
  } catch {
    throw invalid(`${field} is invalid`);
  }
}

function parseSnapshotMovement(value: unknown, field: string): LiquidationDistributionSnapshotMovement {
  if (!isPlainObject(value)) throw invalid(`${field} is invalid`);
  const movementId = requiredString(value.movementId, `${field} movementId`);
  const scope = value.scope;
  if (!isDistributionScope(scope)) throw invalid(`${field} scope is invalid`);
  const amountMinor = requiredMinor(value.amountMinor, `${field} amountMinor`);
  const unitGroupId = value.unitGroupId === null ? null : requiredString(value.unitGroupId, `${field} unitGroupId`);
  if (scope === 'UNIT_GROUP' && unitGroupId === null) {
    throw invalid(`${field} unitGroupId is required`);
  }
  if (scope !== 'UNIT_GROUP' && unitGroupId !== null) {
    throw invalid(`${field} unitGroupId is unexpected`);
  }
  const totalWeight = decimalString(value.totalWeight, `${field} totalWeight`);
  if (new Prisma.Decimal(totalWeight).isZero()) throw invalid(`${field} totalWeight is invalid`);
  const weightSource = value.weightSource;
  if (weightSource !== 'COEFFICIENT' && weightSource !== 'M2' && weightSource !== 'EQUAL') {
    throw invalid(`${field} weightSource is invalid`);
  }
  if (!Array.isArray(value.recipientUnitIds) || !Array.isArray(value.recipients) || !Array.isArray(value.allocations)) {
    throw invalid(`${field} recipients or allocations are invalid`);
  }
  const recipientUnitIds = value.recipientUnitIds.map((unitId, index) =>
    requiredString(unitId, `${field} recipientUnitIds.${index}`),
  );
  assertUniqueIds(recipientUnitIds, `${field} recipientUnitIds`);
  const recipients = value.recipients.map((recipient, index) =>
    parseSnapshotRecipient(recipient, `${field} recipient ${index}`),
  );
  if (recipients.length === 0) {
    throw invalid(`${field} requires recipients`);
  }
  assertUniqueIds(recipients.map((recipient) => recipient.unitId), `${field} recipient unitId`);
  const allocations = value.allocations.map((allocation, index) =>
    parseAllocation(allocation, `${field} allocation ${index}`),
  );
  assertUniqueIds(allocations.map((allocation) => allocation.unitId), `${field} allocation unitId`);
  return {
    movementId,
    scope,
    unitGroupId,
    amountMinor,
    weightSource,
    totalWeight,
    recipientUnitIds,
    recipients,
    allocations,
  };
}

function parseSnapshotRecipient(value: unknown, field: string): LiquidationDistributionSnapshotRecipient {
  if (!isPlainObject(value)) throw invalid(`${field} is invalid`);
  const coefficient = nullableDecimalString(value.coefficient, `${field} coefficient`);
  const m2 = nullableDecimalString(value.m2, `${field} m2`);
  const weight = decimalString(value.weight, `${field} weight`);
  if (new Prisma.Decimal(weight).isNegative()) throw invalid(`${field} weight is invalid`);
  return {
    unitId: requiredString(value.unitId, `${field} unitId`),
    unitCode: requiredString(value.unitCode, `${field} unitCode`),
    unitLabel: nullableString(value.unitLabel, `${field} unitLabel`),
    coefficient,
    m2,
    weight,
  };
}

function parseAllocation(value: unknown, field: string): LiquidationDistributionAllocation {
  if (!isPlainObject(value)) throw invalid(`${field} is invalid`);
  return {
    unitId: requiredString(value.unitId, `${field} unitId`),
    unitCode: requiredString(value.unitCode, `${field} unitCode`),
    unitLabel: nullableString(value.unitLabel, `${field} unitLabel`),
    amountMinor: requiredMinor(value.amountMinor, `${field} amountMinor`),
  };
}

function decimalString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalid(`${field} is invalid`);
  try {
    const decimal = new Prisma.Decimal(value);
    if (!decimal.isFinite()) throw invalid(`${field} is invalid`);
    return decimal.toString();
  } catch {
    throw invalid(`${field} is invalid`);
  }
}

function nullableDecimalString(value: unknown, field: string): string | null {
  if (value === null) return null;
  const decimal = decimalString(value, field);
  if (new Prisma.Decimal(decimal).isNegative()) throw invalid(`${field} is invalid`);
  return decimal;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalid(`${field} is invalid`);
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredString(value, field);
}

function requiredMinor(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalid(`${field} is invalid`);
  }
  return value;
}

function assertMinorAmount(value: number, field: string): void {
  requiredMinor(value, field);
}

function decimalToMinor(value: Prisma.Decimal, field: string): number {
  if (!value.isInteger() || value.isNegative() || value.greaterThan(Number.MAX_SAFE_INTEGER)) {
    throw invalid(`${field} is invalid`);
  }
  return value.toNumber();
}

function safeAdd(left: number, right: number, field: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) throw invalid(`${field} is invalid`);
  return result;
}

function assertUniqueIds(ids: readonly string[], field: string): void {
  if (new Set(ids).size !== ids.length) throw invalid(`${field} contains duplicates`);
}

function isDistributionScope(value: unknown): value is LiquidationDistributionScope {
  return value === 'BUILDING' || value === 'UNIT_GROUP' || value === 'ADJUSTMENT';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertNonEmptyString(value: unknown, field: string): void {
  requiredString(value, field);
}

function invalid(message: string): BadRequestException {
  return new BadRequestException(`Liquidation distribution ${message}`);
}
