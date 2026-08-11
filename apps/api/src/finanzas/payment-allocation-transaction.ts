import {
  ChargeStatus,
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
  if (!payment || payment.status !== PaymentStatus.APPROVED) return;
  const allocationMode = assertPaymentAllocationCurrencyMode(
    payment.currency,
    payment.paymentAllocations,
  );
  const snapshotState = classifyFunctionalSnapshot(payment);
  if (snapshotState === 'PARTIAL_INVALID' || allocationMode === null) return;

  let originalConsumed = 0;
  let functionalConsumed = 0;
  for (const allocation of payment.paymentAllocations) {
    const sameCurrency = allocation.charge.currency === payment.currency;
    if (allocation.paymentOriginalAmountMinor !== null) {
      originalConsumed += allocation.paymentOriginalAmountMinor;
    } else if (sameCurrency) {
      originalConsumed += allocation.amount;
    }
    if (!sameCurrency && allocation.charge.currency === payment.functionalCurrencyCode) {
      functionalConsumed += allocation.amount;
    }
  }

  const allPaid = payment.paymentAllocations.every(
    (allocation) => allocation.charge.status === ChargeStatus.PAID,
  );
  const completelyConsumed = allocationMode === 'CROSS'
    ? snapshotState === 'COMPLETE' &&
      originalConsumed === payment.amount &&
      functionalConsumed === payment.functionalAmountMinor
    : originalConsumed === payment.amount;
  if (allPaid && completelyConsumed) {
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.RECONCILED, updatedAt: new Date() },
    });
  }
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

  assertPaymentAllocationCurrencyMode(
    payment.currency,
    payment.paymentAllocations,
    charge.currency,
  );

  if (payment.status !== PaymentStatus.APPROVED && payment.status !== PaymentStatus.RECONCILED) {
    throw new ConflictException(`Cannot allocate payment in status ${payment.status}`);
  }
  if (payment.paymentAllocations.some((allocation) => allocation.chargeId === charge.id)) {
    throw new ConflictException('Allocation already exists for this payment/charge pair');
  }

  const originalConsumed = payment.paymentAllocations.reduce((sum, allocation) => {
    if (allocation.paymentOriginalAmountMinor !== null) return sum + allocation.paymentOriginalAmountMinor;
    return allocation.charge.currency === payment.currency ? sum + allocation.amount : sum;
  }, 0);
  if (originalConsumed > payment.amount) {
    throw new UnprocessableEntityException({ statusCode: 422, error: 'PAYMENT_ORIGINAL_AMOUNT_EXCEEDED' });
  }
  const sameCurrency = payment.currency === charge.currency;
  let originalShare = amount;
  if (!sameCurrency) {
    const snapshotState = classifyFunctionalSnapshot(payment);
    if (snapshotState === 'LEGACY_NULL') {
      throw new UnprocessableEntityException({ statusCode: 422, error: 'PAYMENT_LEGACY_SNAPSHOT_REQUIRED' });
    }
    if (snapshotState !== 'COMPLETE') {
      throw new UnprocessableEntityException({ statusCode: 422, error: 'PAYMENT_FUNCTIONAL_SNAPSHOT_INVALID' });
    }
    if (payment.functionalCurrencyCode !== charge.currency || payment.functionalAmountMinor === null) {
      throw new UnprocessableEntityException({ statusCode: 422, error: 'PAYMENT_ALLOCATION_CURRENCY_NOT_SUPPORTED' });
    }
    const functionalConsumed = payment.paymentAllocations.reduce(
      (sum, allocation) =>
        allocation.charge.currency === payment.functionalCurrencyCode &&
        allocation.charge.currency !== payment.currency
          ? sum + allocation.amount
          : sum,
      0,
    );
    const functionalRemaining = payment.functionalAmountMinor - functionalConsumed;
    const originalRemaining = payment.amount - originalConsumed;
    const originalBackedFunctional = new Prisma.Decimal(originalRemaining)
      .mul(payment.functionalAmountMinor)
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

  const chargeAllocations = charge.paymentAllocations ?? [];
  const effectiveConsumed = chargeAllocations.reduce(
    (sum, allocation) => isEffectivePaymentStatus(allocation.payment.status) ? sum + allocation.amount : sum,
    0,
  );
  const reservedConsumed = chargeAllocations.reduce(
    (sum, allocation) => allocation.payment.status === PaymentStatus.SUBMITTED ? sum + allocation.amount : sum,
    0,
  );
  if (amount > charge.amount - effectiveConsumed - reservedConsumed) {
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
