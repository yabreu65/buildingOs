import type { Payment } from './payments.types';
import type { PaymentSubmitFormValues } from './payments.schema';

/**
 * Adapter: convierte PaymentSubmitFormValues (Zod/RHF) a Payment (dominio).
 *
 * Responsable de:
 * - Generar id único
 * - Setear status inicial PENDING
 * - Setear createdAt con timestamp actual
 * - Completar campos opcionales
 *
 * Mantiene separación clara entre tipos Form y Dominio.
 */
export function toPayment(formData: PaymentSubmitFormValues): Payment {
  return {
    id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    unitId: formData.unitId,
    amount: formData.amount,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  };
}

/**
 * (Opcional) Adapter inverso: Payment -> PaymentSubmitFormValues
 * Útil para editar payments existentes en el futuro.
 */
export function fromPayment(payment: Payment): PaymentSubmitFormValues {
  return {
    unitId: payment.unitId,
    amount: payment.amount,
    reference: '',
    paidAt: payment.createdAt.split('T')[0],
  };
}
