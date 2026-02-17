import { z } from 'zod';

/**
 * Schema Zod para el formulario de Payment Submission.
 * Separado del modelo de dominio (Payment) para permitir:
 * - Validaciones específicas del formulario
 * - Conversiones de tipos (string -> number)
 * - Campos opcionales en el form que son requeridos en el dominio
 */
export const paymentSubmitSchema = z.object({
  unitId: z.string().min(1, 'Selecciona una unidad'),
  amount: z
    .number('El monto debe ser un número')
    .positive('El monto debe ser mayor a 0'),
  reference: z.string(),
  paidAt: z.string(),
});

/**
 * Type inferido de Zod para el formulario.
 * Usado en useForm<PaymentSubmitFormValues>
 *
 * Diferencias con Payment:
 * - amount: number (en el form es valueAsNumber)
 * - reference, paidAt: inicializados con defaultValues en useForm
 */
export type PaymentSubmitFormValues = z.infer<typeof paymentSubmitSchema>;
