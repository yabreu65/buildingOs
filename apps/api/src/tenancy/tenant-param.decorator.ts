import { SetMetadata } from '@nestjs/common';

/**
 * Decorador opcional para especificar el nombre del parámetro que contiene el tenantId.
 *
 * Uso:
 * @TenantParam('organizationId')
 * async getOrgData(@Param('organizationId') orgId: string) { ... }
 *
 * Default si no se usa: 'tenantId'
 *
 * Implementación futura:
 * - Leer metadata en TenantAccessGuard
 * - Usar dinámicamente: request.params[paramName]
 */
export const TENANT_PARAM_KEY = 'tenant_param';

export const TenantParam = (paramName: string = 'tenantId') =>
  SetMetadata(TENANT_PARAM_KEY, paramName);
