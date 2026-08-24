import {
  ChargeStatus,
  PaymentAuditAction,
  PaymentStatus,
  Prisma,
  type PaymentAllocation,
} from '@prisma/client';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { classifyFunctionalSnapshot } from './functional-snapshot';
import { isEffectivePaymentStatus } from './payment-status-semantics';

export interface AllocationScope {
  readonly tenantId: string;
  readonly buildingId: string;
  readonly paymentId: string;
  readonly chargeId: string;
}

interface AllocationChargeCurrency {
  readonly charge: { readonly currency: string };
}

interface PaymentSideAllocation extends AllocationChargeCurrency {
  readonly amount: number;
  readonly paymentOriginalAmountMinor: number | null;
}

interface PaymentSideAggregateInput {
  readonly amount: number;
  readonly currency: string;
  readonly functionalAmountMinor: number | null;
  readonly functionalCurrencyCode: string | null;
  readonly exchangeRateId: string | null;
  readonly exchangeRateValue: Prisma.Decimal | null;
  readonly exchangeRateDirection: string | null;
  readonly exchangeRateEffectiveAt: Date | null;
  readonly conversionDate: Date | null;
  readonly paymentAllocations: readonly PaymentSideAllocation[];
}

export interface PaymentSideAllocationAggregate {
  readonly mode: PaymentAllocationCurrencyMode;
  readonly originalConsumedMinor: number;
  readonly originalRemainingMinor: number;
  readonly functionalConsumedMinor: number | null;
  readonly functionalRemainingMinor: number | null;
}

export type PaymentSideAllocationClassification =
  | { readonly kind: 'MIXED'; readonly aggregate: null }
  | { readonly kind: 'UNRESOLVED_LEGACY_CROSS'; readonly aggregate: null }
  | {
      readonly kind: 'UNRESOLVED_CROSS_SNAPSHOT';
      readonly reason: 'LEGACY_NULL' | 'PARTIAL_INVALID' | 'CURRENCY_NOT_SUPPORTED';
      readonly aggregate: null;
    }
  | { readonly kind: 'CANONICAL'; readonly aggregate: PaymentSideAllocationAggregate };

interface ChargeAvailabilityAllocation {
  readonly amount: number;
  readonly payment: { readonly id?: string; readonly status: PaymentStatus };
}

export interface DeletedAllocationMetadata {
  readonly id: string;
  readonly paymentId: string;
  readonly chargeId: string;
  readonly amount: number;
}

type PaymentAllocationCurrencyMode = 'SAME' | 'CROSS' | null;

export function assertPaymentAllocationCurrencyMode(
  paymentCurrency: string,
  allocations: readonly AllocationChargeCurrency[],
  candidateChargeCurrency?: string,
): PaymentAllocationCurrencyMode {
  const currencies = candidateChargeCurrency
    ? [...allocations.map((allocation) => allocation.charge.currency), candidateChargeCurrency]
    : allocations.map((allocation) => allocation.charge.currency);
  const hasSame = currencies.some((currency) => currency === paymentCurrency);
  const hasCross = currencies.some((currency) => currency !== paymentCurrency);
  if (hasSame && hasCross) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'PAYMENT_ALLOCATION_CURRENCY_NOT_SUPPORTED',
    });
  }
  if (hasSame) return 'SAME';
  if (hasCross) return 'CROSS';
  return null;
}

export function classifyPaymentSideAllocations(
  payment: PaymentSideAggregateInput,
  candidateChargeCurrency?: string,
): PaymentSideAllocationClassification {
  const currencies = candidateChargeCurrency === undefined
    ? payment.paymentAllocations.map((allocation) => allocation.charge.currency)
    : [...payment.paymentAllocations.map((allocation) => allocation.charge.currency), candidateChargeCurrency];
  const hasSame = currencies.some((currency) => currency === payment.currency);
  const hasCross = currencies.some((currency) => currency !== payment.currency);
  if (hasSame && hasCross) return { kind: 'MIXED', aggregate: null };
  const mode: PaymentAllocationCurrencyMode = hasSame ? 'SAME' : hasCross ? 'CROSS' : null;
  const hasUnresolvedLegacyCross = payment.paymentAllocations.some(
    (allocation) => allocation.paymentOriginalAmountMinor === null &&
      allocation.charge.currency !== payment.currency,
  );
  if (hasUnresolvedLegacyCross) return { kind: 'UNRESOLVED_LEGACY_CROSS', aggregate: null };
  let functionalConsumedMinor: number | null = null;

  if (mode === 'CROSS') {
    const snapshotState = classifyFunctionalSnapshot(payment);
    if (snapshotState === 'LEGACY_NULL') {
      return { kind: 'UNRESOLVED_CROSS_SNAPSHOT', reason: 'LEGACY_NULL', aggregate: null };
    }
    if (snapshotState !== 'COMPLETE') {
      return { kind: 'UNRESOLVED_CROSS_SNAPSHOT', reason: 'PARTIAL_INVALID', aggregate: null };
    }
    const functionalCurrencyCode = payment.functionalCurrencyCode;
    const functionalAmountMinor = payment.functionalAmountMinor;
    if (
      functionalCurrencyCode === null ||
      functionalAmountMinor === null ||
      functionalCurrencyCode === payment.currency ||
      (candidateChargeCurrency !== undefined && candidateChargeCurrency !== functionalCurrencyCode) ||
      payment.paymentAllocations.some(
        (allocation) => allocation.charge.currency !== functionalCurrencyCode,
      )
    ) {
      return { kind: 'UNRESOLVED_CROSS_SNAPSHOT', reason: 'CURRENCY_NOT_SUPPORTED', aggregate: null };
    }
    functionalConsumedMinor = payment.paymentAllocations.reduce(
      (sum, allocation) => sum + allocation.amount,
      0,
    );
  }

  const originalConsumedMinor = payment.paymentAllocations.reduce((sum, allocation) => {
    if (allocation.paymentOriginalAmountMinor !== null) {
      return sum + allocation.paymentOriginalAmountMinor;
    }
    if (allocation.charge.currency === payment.currency) return sum + allocation.amount;
    return sum;
  }, 0);

  return {
    kind: 'CANONICAL',
    aggregate: {
      mode,
      originalConsumedMinor,
      originalRemainingMinor: payment.amount - originalConsumedMinor,
      functionalConsumedMinor,
      functionalRemainingMinor: functionalConsumedMinor === null || payment.functionalAmountMinor === null
        ? null
        : payment.functionalAmountMinor - functionalConsumedMinor,
    },
  };
}

export function aggregatePaymentSideAllocations(
  payment: PaymentSideAggregateInput,
  candidateChargeCurrency?: string,
): PaymentSideAllocationAggregate {
  const classification = classifyPaymentSideAllocations(payment, candidateChargeCurrency);
  if (classification.kind === 'MIXED') {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'PAYMENT_ALLOCATION_CURRENCY_NOT_SUPPORTED',
    });
  }
  if (classification.kind === 'UNRESOLVED_LEGACY_CROSS') {
    throw new UnprocessableEntityException({ statusCode: 422, error: 'PAYMENT_LEGACY_SNAPSHOT_REQUIRED' });
  }
  if (classification.kind === 'UNRESOLVED_CROSS_SNAPSHOT') {
    const error = classification.reason === 'LEGACY_NULL'
      ? 'PAYMENT_LEGACY_SNAPSHOT_REQUIRED'
      : classification.reason === 'PARTIAL_INVALID'
        ? 'PAYMENT_FUNCTIONAL_SNAPSHOT_INVALID'
        : 'PAYMENT_ALLOCATION_CURRENCY_NOT_SUPPORTED';
    throw new UnprocessableEntityException({ statusCode: 422, error });
  }
  return classification.aggregate;
}

export async function lockPaymentForAllocation(
  tx: Prisma.TransactionClient,
  scope: Pick<AllocationScope, 'tenantId' | 'buildingId' | 'paymentId'>,
): Promise<void> {
  await tx.$queryRaw(
    Prisma.sql`SELECT 1 FROM "Payment" WHERE id = ${scope.paymentId} AND "tenantId" = ${scope.tenantId} AND "buildingId" = ${scope.buildingId} FOR UPDATE`,
  );
}

export async function lockChargesForAllocation(
  tx: Prisma.TransactionClient,
  tenantId: string,
  buildingId: string,
  chargeIds: readonly string[],
): Promise<void> {
  for (const chargeId of [...new Set(chargeIds)].sort()) {
    await tx.$queryRaw(
      Prisma.sql`SELECT 1 FROM "Charge" WHERE id = ${chargeId} AND "tenantId" = ${tenantId} AND "buildingId" = ${buildingId} FOR UPDATE`,
    );
  }
}

async function loadLockedPayment(tx: Prisma.TransactionClient, scope: AllocationScope) {
  const payment = await tx.payment.findFirst({
    where: {
      id: scope.paymentId,
      tenantId: scope.tenantId,
      buildingId: scope.buildingId,
    },
    include: {
      paymentAllocations: { include: { charge: { select: { currency: true } } } },
    },
  });
  if (!payment) {
    throw new NotFoundException('Payment not found or does not belong to this building/tenant');
  }
  return payment;
}

async function loadLockedCharge(tx: Prisma.TransactionClient, scope: AllocationScope) {
  const charge = await tx.charge.findFirst({
    where: {
      id: scope.chargeId,
      tenantId: scope.tenantId,
      buildingId: scope.buildingId,
      canceledAt: null,
    },
    include: {
      paymentAllocations: {
        include: { payment: { select: { status: true } } },
      },
    },
  });
  if (!charge) {
    throw new NotFoundException('Charge not found or does not belong to this building/tenant');
  }
  return charge;
}

export async function recalculateLockedCharge(
  tx: Prisma.TransactionClient,
  chargeId: string,
): Promise<void> {
  const charge = await tx.charge.findUnique({
    where: { id: chargeId },
    include: {
      paymentAllocations: {
        include: { payment: { select: { status: true } } },
      },
    },
  });
  if (!charge) return;
  const consumed = charge.paymentAllocations.reduce(
    (sum, allocation) =>
      isEffectivePaymentStatus(allocation.payment.status) ? sum + allocation.amount : sum,
    0,
  );
  const status = consumed === 0
    ? ChargeStatus.PENDING
    : consumed < charge.amount
      ? ChargeStatus.PARTIAL
      : ChargeStatus.PAID;
  if (status !== charge.status) {
    await tx.charge.update({ where: { id: chargeId }, data: { status, updatedAt: new Date() } });
  }
}

export function calculateChargeAvailableOutstanding(
  chargeAmount: number,
  allocations: readonly ChargeAvailabilityAllocation[],
  currentPaymentId?: string,
): number {
  const consumed = allocations.reduce((sum, allocation) => {
    if (currentPaymentId !== undefined && allocation.payment.id === currentPaymentId) return sum;
    return isEffectivePaymentStatus(allocation.payment.status) ||
      allocation.payment.status === PaymentStatus.SUBMITTED
      ? sum + allocation.amount
      : sum;
  }, 0);
  return chargeAmount - consumed;
}

export async function reconcilePaymentWhenConsumed(
  tx: Prisma.TransactionClient,
  paymentId: string,
): Promise<void> {
  const payment = await tx.payment.findUnique({
    where: { id: paymentId },
    include: {
      paymentAllocations: { include: { charge: { select: { currency: true, status: true } } } },
    },
  });
  if (
    !payment ||
    (payment.status !== PaymentStatus.APPROVED && payment.status !== PaymentStatus.RECONCILED)
  ) return;
  if (classifyFunctionalSnapshot(payment) === 'PARTIAL_INVALID') return;
  const aggregate = aggregatePaymentSideAllocations(payment);

  const allPaid = payment.paymentAllocations.every(
    (allocation) => allocation.charge.status === ChargeStatus.PAID,
  );
  const completelyConsumed = aggregate.mode === 'CROSS'
    ? aggregate.originalRemainingMinor === 0 && aggregate.functionalRemainingMinor === 0
    : aggregate.mode === 'SAME' && aggregate.originalRemainingMinor === 0;
  const nextStatus = allPaid && completelyConsumed
    ? PaymentStatus.RECONCILED
    : PaymentStatus.APPROVED;
  if (nextStatus !== payment.status) {
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: nextStatus, updatedAt: new Date() },
    });

    if (nextStatus === PaymentStatus.RECONCILED) {
      await tx.paymentAuditLog.create({
        data: {
          tenantId: payment.tenantId,
          paymentId,
          action: PaymentAuditAction.RECONCILED,
          membershipId: null,
          reason: null,
          comment: null,
          metadata: { status: PaymentStatus.RECONCILED },
        },
      });
    }
  }
}

async function reconcilePaymentAfterAllocationDelete(
  tx: Prisma.TransactionClient,
  paymentId: string,
): Promise<void> {
  const payment = await tx.payment.findUnique({
    where: { id: paymentId },
    include: {
      paymentAllocations: { include: { charge: { select: { currency: true, status: true } } } },
    },
  });
  if (
    !payment ||
    (payment.status !== PaymentStatus.APPROVED && payment.status !== PaymentStatus.RECONCILED)
  ) return;

  const classification = classifyPaymentSideAllocations(payment);
  if (classification.kind === 'CANONICAL') {
    await reconcilePaymentWhenConsumed(tx, paymentId);
    return;
  }
  if (payment.status === PaymentStatus.RECONCILED) {
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.APPROVED, updatedAt: new Date() },
    });
  }
}

export async function deleteLockedAllocation(
  tx: Prisma.TransactionClient,
  tenantId: string,
  buildingId: string,
  allocationId: string,
): Promise<DeletedAllocationMetadata> {
  const discovered = await tx.paymentAllocation.findFirst({
    where: { id: allocationId, tenantId },
    select: { paymentId: true, chargeId: true },
  });
  const notFound = () => new NotFoundException('Allocation not found or does not belong to this tenant');
  if (!discovered) throw notFound();

  await lockPaymentForAllocation(tx, { tenantId, buildingId, paymentId: discovered.paymentId });
  await lockChargesForAllocation(tx, tenantId, buildingId, [discovered.chargeId]);
  const allocation = await tx.paymentAllocation.findFirst({
    where: {
      id: allocationId,
      tenantId,
      payment: { tenantId, buildingId },
      charge: { tenantId, buildingId },
    },
    select: { id: true, paymentId: true, chargeId: true, amount: true },
  });
  if (!allocation) throw notFound();

  const deleted = await tx.paymentAllocation.deleteMany({ where: { id: allocationId, tenantId } });
  if (deleted.count !== 1) throw notFound();
  await recalculateLockedCharge(tx, allocation.chargeId);
  await reconcilePaymentAfterAllocationDelete(tx, allocation.paymentId);
  return allocation;
}

export async function createLockedAllocation(
  tx: Prisma.TransactionClient,
  scope: AllocationScope,
  amount: number,
): Promise<PaymentAllocation> {
  await lockPaymentForAllocation(tx, scope);
  const payment = await loadLockedPayment(tx, scope);
  await lockChargesForAllocation(tx, scope.tenantId, scope.buildingId, [scope.chargeId]);
  const charge = await loadLockedCharge(tx, scope);

  if (payment.status !== PaymentStatus.APPROVED && payment.status !== PaymentStatus.RECONCILED) {
    throw new ConflictException(`Cannot allocate payment in status ${payment.status}`);
  }
  if (payment.paymentAllocations.some((allocation) => allocation.chargeId === charge.id)) {
    throw new ConflictException('Allocation already exists for this payment/charge pair');
  }

  const aggregate = aggregatePaymentSideAllocations(payment, charge.currency);
  const originalConsumed = aggregate.originalConsumedMinor;
  if (originalConsumed > payment.amount) {
    throw new UnprocessableEntityException({ statusCode: 422, error: 'PAYMENT_ORIGINAL_AMOUNT_EXCEEDED' });
  }
  const sameCurrency = payment.currency === charge.currency;
  let originalShare = amount;
  if (!sameCurrency) {
    const functionalRemaining = aggregate.functionalRemainingMinor;
    const functionalAmountMinor = payment.functionalAmountMinor;
    if (functionalRemaining === null || functionalAmountMinor === null) {
      throw new UnprocessableEntityException({ statusCode: 422, error: 'PAYMENT_FUNCTIONAL_SNAPSHOT_INVALID' });
    }
    const originalRemaining = payment.amount - originalConsumed;
    const originalBackedFunctional = new Prisma.Decimal(originalRemaining)
      .mul(functionalAmountMinor)
      .div(payment.amount)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN)
      .toNumber();
    const crossAvailable = Math.min(functionalRemaining, originalBackedFunctional);
    if (amount !== functionalRemaining && amount > crossAvailable) {
      throw new UnprocessableEntityException({ statusCode: 422, error: 'PAYMENT_FUNCTIONAL_AMOUNT_EXCEEDED' });
    }
    originalShare = amount === functionalRemaining
      ? originalRemaining
      : new Prisma.Decimal(originalRemaining)
          .mul(amount)
          .div(functionalRemaining)
          .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_EVEN)
          .toNumber();
  }
  if (originalConsumed + originalShare > payment.amount) {
    throw new UnprocessableEntityException({ statusCode: 422, error: 'PAYMENT_ORIGINAL_AMOUNT_EXCEEDED' });
  }

  if (amount > calculateChargeAvailableOutstanding(charge.amount, charge.paymentAllocations ?? [])) {
    throw new ConflictException('The allocation exceeds the charge available outstanding');
  }

  const allocation = await tx.paymentAllocation.create({
    data: {
      tenantId: scope.tenantId,
      paymentId: scope.paymentId,
      chargeId: scope.chargeId,
      amount,
      paymentOriginalAmountMinor: originalShare,
    },
  });
  await recalculateLockedCharge(tx, scope.chargeId);
  await reconcilePaymentWhenConsumed(tx, scope.paymentId);
  return allocation;
}
