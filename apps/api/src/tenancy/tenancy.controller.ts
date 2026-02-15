import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from './tenant-access.guard';
import {
  TenancyStatsService,
  TenantStatsResponse,
  TenantBillingResponse,
  AuditLogsResultResponse,
  AuditLogFilter,
} from './tenancy-stats.service';

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
  constructor(private readonly tenancyStatsService: TenancyStatsService) {}

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

  /**
   * GET /tenants/:tenantId/stats
   *
   * Obtiene estadísticas del tenant:
   * - Total buildings, units
   * - Unit occupancy status breakdown
   * - Total residents
   *
   * @param tenantId ID del tenant
   * @returns TenantStatsResponse
   */
  @UseGuards(JwtAuthGuard, TenantAccessGuard)
  @Get(':tenantId/stats')
  async getTenantStats(
    @Param('tenantId') tenantId: string,
  ): Promise<TenantStatsResponse> {
    return this.tenancyStatsService.getTenantStats(tenantId);
  }

  /**
   * GET /tenants/:tenantId/billing
   *
   * Obtiene información de facturación del tenant:
   * - Status de suscripción
   * - Plan actual con entitlements
   * - Uso actual vs límites
   *
   * @param tenantId ID del tenant
   * @returns TenantBillingResponse
   */
  @UseGuards(JwtAuthGuard, TenantAccessGuard)
  @Get(':tenantId/billing')
  async getTenantBilling(
    @Param('tenantId') tenantId: string,
  ): Promise<TenantBillingResponse> {
    return this.tenancyStatsService.getTenantBilling(tenantId);
  }

  /**
   * GET /tenants/:tenantId/audit-logs
   *
   * Obtiene audit logs del tenant con paginación y filtros opcionales.
   *
   * Query params:
   * - skip: número de registros a saltar (default: 0)
   * - take: número de registros a devolver (default: 10)
   * - action: filtrar por tipo de acción (opcional)
   * - dateFrom: filtrar desde esta fecha (opcional, ISO string)
   * - dateTo: filtrar hasta esta fecha (opcional, ISO string)
   *
   * @param tenantId ID del tenant
   * @param filters Filtros de paginación y búsqueda
   * @returns AuditLogsResultResponse
   */
  @UseGuards(JwtAuthGuard, TenantAccessGuard)
  @Get(':tenantId/audit-logs')
  async getTenantAuditLogs(
    @Param('tenantId') tenantId: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('action') action?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ): Promise<AuditLogsResultResponse> {
    const filters: AuditLogFilter = {
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      action: action as any,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
    };

    return this.tenancyStatsService.getTenantAuditLogs(tenantId, filters);
  }
}
