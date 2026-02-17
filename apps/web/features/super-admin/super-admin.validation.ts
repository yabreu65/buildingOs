import { z } from 'zod';

/**
 * Schema de validación para Zod
 */

/**
 * Schema para crear tenant
 */
export const createTenantSchema = z.object({
  name: z
    .string()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(100, 'El nombre no puede exceder 100 caracteres'),
  type: z.enum(['ADMINISTRADORA', 'EDIFICIO_AUTOGESTION']),
  plan: z.enum(['FREE', 'BASIC', 'PRO', 'ENTERPRISE']),
  ownerEmail: z.string().email('Email inválido'),
});

/**
 * Schema para actualizar tenant
 */
export const updateTenantSchema = z.object({
  name: z
    .string()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(100, 'El nombre no puede exceder 100 caracteres')
    .optional(),
  plan: z
    .enum(['FREE', 'BASIC', 'PRO', 'ENTERPRISE'])
    .optional(),
  status: z
    .enum(['TRIAL', 'ACTIVE', 'SUSPENDED'])
    .optional(),
});

// Type inference
export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

/**
 * Valida crear tenant con mensajes personalizados
 */
export function validateCreateTenant(data: unknown): { valid: boolean; errors?: Record<string, string> } {
  try {
    createTenantSchema.parse(data);
    return { valid: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors: Record<string, string> = {};
      error.issues.forEach((err) => {
        const path = err.path.join('.');
        errors[path] = err.message;
      });
      return { valid: false, errors };
    }
    return { valid: false, errors: { general: 'Error de validación' } };
  }
}

/**
 * Valida actualizar tenant con mensajes personalizados
 */
export function validateUpdateTenant(data: unknown): { valid: boolean; errors?: Record<string, string> } {
  try {
    updateTenantSchema.parse(data);
    return { valid: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors: Record<string, string> = {};
      error.issues.forEach((err) => {
        const path = err.path.join('.');
        errors[path] = err.message;
      });
      return { valid: false, errors };
    }
    return { valid: false, errors: { general: 'Error de validación' } };
  }
}
