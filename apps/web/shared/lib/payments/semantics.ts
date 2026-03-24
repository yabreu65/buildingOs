export type PaymentRole = 'unit' | 'admin';

export type PaymentStatusUI =
  | 'PENDING'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'RECONCILED';

export type PaymentStatusTone = 'warning' | 'success' | 'danger' | 'muted';

export const paymentStatusLabels: Record<
  PaymentStatusUI,
  { unit: string; admin: string; tone: PaymentStatusTone }
> = {
  PENDING: {
    unit: 'En revision',
    admin: 'Pendiente de confirmacion',
    tone: 'warning',
  },
  SUBMITTED: {
    unit: 'Pago reportado',
    admin: 'Pendiente de confirmacion',
    tone: 'warning',
  },
  APPROVED: {
    unit: 'Pago confirmado',
    admin: 'Confirmado',
    tone: 'success',
  },
  REJECTED: {
    unit: 'Pago rechazado',
    admin: 'Rechazado',
    tone: 'danger',
  },
  RECONCILED: {
    unit: 'Conciliado',
    admin: 'Conciliado',
    tone: 'muted',
  },
};

const paymentToneClasses: Record<PaymentStatusTone, string> = {
  warning: 'bg-yellow-100 text-yellow-800',
  success: 'bg-green-100 text-green-800',
  danger: 'bg-red-100 text-red-800',
  muted: 'bg-slate-100 text-slate-700',
};

/**
 * Returns the role-aware label for a payment status.
 */
export function getPaymentStatusLabel(
  status: PaymentStatusUI,
  role: PaymentRole
): string {
  return paymentStatusLabels[status][role];
}

/**
 * Returns the visual tone for a payment status.
 */
export function getPaymentStatusTone(status: PaymentStatusUI): PaymentStatusTone {
  return paymentStatusLabels[status].tone;
}

/**
 * Returns the badge className for a payment status.
 */
export function getPaymentStatusBadgeClass(status: PaymentStatusUI): string {
  return paymentToneClasses[getPaymentStatusTone(status)];
}
