import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
  ValidationPipe,
} from '@nestjs/common';
import type { AuditAction } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsInt,
  IsIn,
  IsOptional,
  Min,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../common/types/request.types';
import { TenantAccessGuard } from './tenant-access.guard';
import {
  TenancyStatsService,
  TenantStatsResponse,
  TenantBillingResponse,
  AuditLogsResultResponse,
  AuditLogFilter,
} from './tenancy-stats.service';
import { BrandingService } from './branding.service';
import {
  GetBrandingResponseDto,
  UpdateBrandingDto,
} from './dto/branding.dto';

interface HealthResponse {
  ok: boolean;
  tenantId: string;
}

const AUDIT_ACTION_VALUES = [
  'TENANT_CREATE',
  'TENANT_UPDATE',
  'TENANT_DELETE',
  'TENANT_BRANDING_UPDATED',
  'SUBSCRIPTION_CREATE',
  'SUBSCRIPTION_UPDATE',
  'SUBSCRIPTION_CANCEL',
  'SUBSCRIPTION_PAST_DUE',
  'USER_CREATE',
  'USER_DELETE',
  'OTHER',
  'AUTH_LOGIN',
  'AUTH_LOGOUT',
  'AUTH_FAILED_LOGIN',
  'MEMBERSHIP_INVITE_SENT',
  'MEMBERSHIP_INVITE_ACCEPTED',
  'MEMBERSHIP_INVITE_REVOKED',
  'MEMBERSHIP_INVITE_RESENT',
  'MEMBERSHIP_INVITE_EXPIRED',
  'MEMBERSHIP_ROLE_CHANGED',
  'ROLE_ASSIGNED',
  'ROLE_REMOVED',
  'IMPERSONATION_START',
  'IMPERSONATION_END',
  'BUILDING_CREATE',
  'BUILDING_UPDATE',
  'BUILDING_DELETE',
  'UNIT_CREATE',
  'UNIT_UPDATE',
  'UNIT_DELETE',
  'OCCUPANT_ASSIGN',
  'OCCUPANT_REMOVE',
  'TENANT_MEMBER_CREATE',
  'TENANT_MEMBER_UPDATE',
  'TENANT_MEMBER_INVITED',
  'TENANT_MEMBER_DELETE',
  'TICKET_CREATE',
  'TICKET_UPDATE',
  'TICKET_STATUS_CHANGE',
  'TICKET_ASSIGN',
  'TICKET_COMMENT_ADD',
  'TICKET_DELETE',
  'TICKET_ESCALATED',
  'COMMUNICATION_CREATE_DRAFT',
  'COMMUNICATION_EDIT_DRAFT',
  'COMMUNICATION_SEND',
  'COMMUNICATION_READ',
  'FILE_UPLOADED',
  'DOCUMENT_CREATE',
  'DOCUMENT_VISIBILITY_CHANGED',
  'DOCUMENT_DOWNLOADED',
  'DOCUMENT_DELETE',
  'IMPORT_FILE_LOADED',
  'IMPORT_PREVIEW_READY',
  'IMPORT_PREVIEW_BLOCKED',
  'IMPORT_PREVIEW_FAILED',
  'IMPORT_CONFIRM_STARTED',
  'IMPORT_CONFIRMED',
  'IMPORT_CONFIRM_FAILED',
  'IMPORT_RECONFIRM_ATTEMPT',
  'CHARGE_CREATE',
  'CHARGE_CANCEL',
  'PAYMENT_SUBMIT',
  'PAYMENT_APPROVE',
  'PAYMENT_REJECT',
  'PAYMENT_CANCEL',
  'PAYMENT_ALLOCATE',
  'ALLOCATION_DELETE',
  'VENDOR_CREATE',
  'VENDOR_UPDATE',
  'VENDOR_DELETE',
  'VENDOR_ASSIGN',
  'VENDOR_UNASSIGN',
  'QUOTE_CREATE',
  'QUOTE_STATUS_CHANGE',
  'WORK_ORDER_CREATE',
  'WORK_ORDER_STATUS_CHANGE',
  'SUPPORT_TICKET_CREATE',
  'SUPPORT_TICKET_UPDATE',
  'SUPPORT_TICKET_STATUS_CHANGE',
  'SUPPORT_TICKET_ASSIGN',
  'SUPPORT_TICKET_COMMENT_ADD',
  'SUPPORT_TICKET_CLOSE',
  'NOTIFICATION_CREATED',
  'NOTIFICATION_READ',
  'NOTIFICATION_DELETED',
  'DEMO_SEED_CREATED',
  'REPORT_EXPORTED',
  'AI_INTERACTION',
  'AI_TEMPLATE_RUN',
  'AI_BUDGET_WARNED',
  'AI_BUDGET_BLOCKED',
  'AI_BUDGET_UPDATED',
  'AI_DEGRADED_BUDGET',
  'AI_ACTION_CLICKED',
  'AI_LIMIT_WARNED',
  'AI_LIMIT_BLOCKED',
  'AI_TENANT_OVERRIDE_UPDATED',
  'AI_PLAN_CAPS_CHANGED',
  'PLAN_CHANGE_REQUESTED',
  'PLAN_CHANGE_REQUEST_CANCELED',
  'PLAN_CHANGE_APPROVED',
  'PLAN_CHANGE_REJECTED',
  'LEAD_CREATED',
  'LEAD_STATUS_CHANGED',
  'LEAD_DELETED',
  'LEAD_CONVERTED',
  'UNIT_CATEGORY_CREATE',
  'UNIT_CATEGORY_UPDATE',
  'UNIT_CATEGORY_DELETE',
  'UNIT_CATEGORY_AUTO_ASSIGN',
  'EXPENSE_PERIOD_CREATE',
  'EXPENSE_PERIOD_GENERATE',
  'EXPENSE_PERIOD_PUBLISH',
  'EXPENSE_PERIOD_DELETE',
  'EXPENSE_CREATE',
  'EXPENSE_VALIDATE',
  'EXPENSE_VOID',
  'EXPENSE_UPDATE',
  'EXPENSE_IMPORTED',
  'EXPENSE_LEDGER_CATEGORY_CREATE',
  'EXPENSE_LEDGER_CATEGORY_UPDATE',
  'EXPENSE_LEDGER_CATEGORY_DELETE',
  'LIQUIDATION_DRAFT',
  'LIQUIDATION_REVIEW',
  'LIQUIDATION_PUBLISH',
  'LIQUIDATION_CANCEL',
  'INCOME_CREATE',
  'INCOME_UPDATE',
  'INCOME_RECORD',
  'INCOME_VOID',
  'INCOME_ALLOCATION_CREATE',
  'UNIT_GROUP_CREATE',
  'UNIT_GROUP_DELETE',
  'UNIT_GROUP_MEMBER_ADD',
  'UNIT_GROUP_MEMBER_REMOVE',
  'EXPENSE_ALLOCATION_CREATE',
] as const;

type TenantAuditAction = (typeof AUDIT_ACTION_VALUES)[number];

class TenantAuditLogQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  take?: number;

  @IsOptional()
  @IsIn(AUDIT_ACTION_VALUES)
  action?: TenantAuditAction;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dateFrom?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dateTo?: Date;
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
  constructor(
    private readonly tenancyStatsService: TenancyStatsService,
    private readonly brandingService: BrandingService,
  ) {}

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
    @Query(
      new ValidationPipe({ transform: true, whitelist: true }),
    )
    query: TenantAuditLogQueryDto,
  ): Promise<AuditLogsResultResponse> {
    return this.tenancyStatsService.getTenantAuditLogs(tenantId, query);
  }

  /**
   * GET /tenants/:tenantId/branding
   *
   * Get tenant's branding configuration (logo, colors, name)
   *
   * @param tenantId ID del tenant
   * @returns GetBrandingResponseDto
   */
  @UseGuards(JwtAuthGuard, TenantAccessGuard)
  @Get(':tenantId/branding')
  async getBranding(
    @Param('tenantId') tenantId: string,
  ): Promise<GetBrandingResponseDto> {
    return this.brandingService.getTenantBranding(tenantId);
  }

  /**
   * PATCH /tenants/:tenantId/branding
   *
   * Update tenant's branding configuration
   * Only TENANT_ADMIN or TENANT_OWNER can update
   *
   * @param tenantId ID del tenant
   * @param dto Update branding data
   * @param req Request with user info
   * @returns GetBrandingResponseDto
   */
  @UseGuards(JwtAuthGuard, TenantAccessGuard)
  @Patch(':tenantId/branding')
  async updateBranding(
    @Param('tenantId') tenantId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    dto: UpdateBrandingDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<GetBrandingResponseDto> {
    return this.brandingService.updateBranding(tenantId, dto, req.user);
  }
}
