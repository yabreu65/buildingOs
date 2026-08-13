import { isEffectivePaymentStatus } from './payment-status-semantics';
import {
  CANONICAL_CURRENCIES,
  isCanonicalCurrency,
  type CanonicalCurrency,
} from '@buildingos/contracts';

/**
 * Phase 3F foundation — currency-safe charge-side aggregation.
 *
 * Contract:
 * - Charge.amount is expressed in Charge.currency (integer minor units).
 * - PaymentAllocation.amount is expressed in the SAME Charge.currency.
 * - Charge outstanding (reportable/accounting) =
 *     Charge.amount - SUM(PaymentAllocation.amount WHERE Payment.status is
 *     accounting-effective).
 * - Accounting-effective = APPROVED | RECONCILED (see payment-status-semantics).
 * - SUBMITTED reservations, REJECTED, CANCELED never reduce outstanding.
 * - paymentOriginalAmountMinor, Payment.amount, Payment.currency and
 *   Payment.functionalAmountMinor NEVER participate in charge-side math.
 * - No ExchangeRate lookup, no live FX, no floats.
 */

export interface ChargeOutstandingInputAllocation {
  readonly amount: number;
  readonly payment?: { readonly status?: string | null } | null;
}

export interface ChargeOutstandingInput {
  readonly amount: number;
  readonly paymentAllocations?: readonly ChargeOutstandingInputAllocation[] | null;
}

/**
 * Calculate reportable/accounting outstanding for a single charge,
 * expressed in Charge.currency (integer minor units).
 *
 * Clamping: returns Math.max(0, ...) — never negative — matching the
 * dominant existing contract across BuildingOS callers.
 */
export function calculateChargeOutstandingMinor(charge: ChargeOutstandingInput): number {
  const effectiveAllocated = (charge.paymentAllocations ?? []).reduce(
    (sum, allocation) =>
      isEffectivePaymentStatus(allocation.payment?.status)
        ? sum + allocation.amount
        : sum,
    0,
  );
  return Math.max(0, charge.amount - effectiveAllocated);
}

/**
 * A deterministic currency bucket: an amount expressed in one currency,
 * integer minor units. Never mix currencies inside a single bucket.
 */
export interface CurrencyAmountBucket {
  readonly currency: CanonicalCurrency;
  readonly amountMinor: number;
}

export interface CurrencyAmountInput {
  readonly currency: string;
  readonly amountMinor: number;
}

/**
 * Aggregate integer minor amounts grouped by currency, preserving each
 * currency's own dimension. Never converts, never sums across currencies,
 * never invents a fallback currency.
 *
 * A missing/unknown currency fails fast (throws) instead of producing an
 * unlabeled total. Order of buckets follows CANONICAL_CURRENCIES so output
 * is deterministic regardless of input order. Only amounts for canonical
 * currencies are aggregated; any other value is rejected.
 */
export function sumByCurrency(items: readonly CurrencyAmountInput[]): CurrencyAmountBucket[] {
  const totals = new Map<CanonicalCurrency, number>();

  for (const item of items) {
    if (!isCanonicalCurrency(item.currency)) {
      throw new Error(`sumByCurrency: unsupported currency "${item.currency}"`);
    }
    const current = totals.get(item.currency) ?? 0;
    totals.set(item.currency, current + item.amountMinor);
  }

  return CANONICAL_CURRENCIES.filter((currency) => totals.has(currency)).map((currency) => ({
    currency,
    amountMinor: totals.get(currency) as number,
  }));
}
