/**
 * Single source of truth for which Payment statuses count as effective money.
 *
 * SUBMITTED is a reservation and NEVER counts as effective money.
 * APPROVED and RECONCILED are effective.
 * REJECTED/CANCELED are not effective.
 *
 * Used by Charge.status derivation, PaymentAllocation effective sums,
 * the cancelCharge guard and the payment gateway ledger — one definition.
 */
export const EFFECTIVE_PAYMENT_STATUSES = ['APPROVED', 'RECONCILED'] as const;

export function isEffectivePaymentStatus(status?: string | null): boolean {
  return status === 'APPROVED' || status === 'RECONCILED';
}
