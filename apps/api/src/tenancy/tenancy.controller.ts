import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from './tenant-access.guard';

interface HealthResponse {
  ok: boolean;
  tenantId: string;
}

/**
 * TenancyController: endpoints protegidos con validación de tenant.
 *
 * Todos los endpoints dentro de este controlador validan:
 * 1. JWT token válido (JwtAuthGuard)
 * 2. Membership del usuario en el tenant (TenantAccessGuard)
 */
@Controller('tenants')
export class TenancyController {
  /**
   * GET /tenants/:tenantId/health
   *
   * Endpoint demo que valida acceso al tenant.
   * Solo devuelve 200 si el usuario tiene membership en ese tenant.
   *
   * @param tenantId ID del tenant desde params
   * @returns { ok: true, tenantId }
   */
  @UseGuards(JwtAuthGuard, TenantAccessGuard)
  @Get(':tenantId/health')
  getTenantHealth(@Param('tenantId') tenantId: string): HealthResponse {
    return {
      ok: true,
      tenantId,
    };
  }
}
