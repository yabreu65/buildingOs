import { Type } from 'class-transformer';
import {
  IsOptional,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  UseGuards,
  Request,
  Body,
  Headers,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { FinanzasService } from './finanzas.service';
import { AuthenticatedRequest } from '../common/types/request.types';
import { hasAdministrativePortalAccess } from '../common/portal-context';
import {
  FinancialSummaryQueryDto,
  FinancialSummaryDto,
  FinanceTrendQueryDto,
  MonthlyTrendDto,
  ListPendingPaymentsQueryDto,
  ApprovePaymentDto,
  RejectPaymentDto,
  PaymentMetricsQueryDto,
  PaymentMetricsDto,
  PaymentAuditLogDto,
  PaymentDuplicateCheckResultDto,
  ListTenantChargesQueryDto,
  PaymentDetailDto,
} from './finanzas.dto';
import { Payment } from '@prisma/client';

export class GetPaymentAuditLogQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/**
 * TenantFinanceController: Tenant-level (aggregated) finance endpoints
 * Routes: /finance/*
 *
 * Security:
 * 1. JwtAuthGuard: Requires valid JWT token
 * 2. Auto-scoped to req.tenantId (from JWT claims)
 * 3. No additional building validation needed (aggregates all buildings for tenant)
 */
@Controller('tenants/:tenantId/finance')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class TenantFinanceController {
  constructor(private finanzasService: FinanzasService) {}

  private assertAdministrativePortalAccess(
    userRoles: readonly string[],
    portalContext?: string,
  ): void {
    if (!hasAdministrativePortalAccess(userRoles, portalContext)) {
      throw new ForbiddenException('Solo administradores pueden consultar esta información');
    }
  }

  /**
   * GET /finance/summary
   * Get aggregated financial summary for entire tenant (all buildings)
   *
   * Query params:
   * - period (optional): YYYY-MM format to filter charges by period
   *
   * Returns:
   * - totalCharges: Sum of all active (non-canceled) charges
   * - totalPaid: Sum of allocations from APPROVED payments
   * - totalOutstanding: totalCharges - totalPaid
   * - delinquentUnitsCount: Number of units with past-due charges
   * - topDelinquentUnits: Top 10 units by outstanding amount
   * - currency: ARS
   */
  @Get('summary')
  async getTenantFinancialSummary(
    @Query() query: FinancialSummaryQueryDto,
    @Request() req: AuthenticatedRequest,
    @Headers('x-portal-context') portalContext?: string,
  ): Promise<FinancialSummaryDto> {
    const tenantId = req.tenantId!;
    this.assertAdministrativePortalAccess(req.user.roles || [], portalContext);
    return this.finanzasService.getTenantFinancialSummary(
      tenantId,
      query.period || undefined,
      req.user.roles || [],
      req.user.id,
    );
  }

  /**
   * GET /finance/charges
   * List charges across all buildings for the tenant.
   * Admin/Operator: all tenant charges
   * Resident/Owner: only charges from their assigned units
   */
  @Get('charges')
  async listTenantCharges(
    @Query() query: ListTenantChargesQueryDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const tenantId = req.tenantId!;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    return this.finanzasService.listTenantCharges(
      tenantId,
      userRoles,
      userId,
      query,
    );
  }

  /**
   * GET /finance/payments/pending?status=SUBMITTED&buildingId=xxx&unitId=xxx&dateFrom=xxx&dateTo=xxx
   * Get all pending payments across all buildings for the tenant
   * Supports filtering by building, unit, date range
   */
  @Get('payments/pending')
  async listPendingPayments(
    @Query() query: ListPendingPaymentsQueryDto,
    @Request() req: AuthenticatedRequest,
    @Headers('x-portal-context') portalContext?: string,
  ): Promise<PaymentDetailDto[]> {
    const tenantId = req.tenantId!;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    this.assertAdministrativePortalAccess(userRoles, portalContext);
    return this.finanzasService.listPendingPayments(
      tenantId,
      userRoles,
      userId,
      query,
    );
  }

  /**
   * PATCH /finance/payments/:paymentId/approve
   * Approve a payment across any building in the tenant
   */
  @Patch('payments/:paymentId/approve')
  async approvePayment(
    @Param('paymentId') paymentId: string,
    @Body() dto: ApprovePaymentDto,
    @Request() req: AuthenticatedRequest,
    @Headers('x-portal-context') portalContext?: string,
  ): Promise<PaymentDetailDto> {
    const tenantId = req.tenantId!;
    const userRoles = req.user.roles || [];
    const membershipId = req.user.membershipId || '';
    this.assertAdministrativePortalAccess(userRoles, portalContext);
    return this.finanzasService.approvePaymentTenant(
      tenantId,
      paymentId,
      userRoles,
      membershipId,
      dto,
    );
  }

  /**
   * PATCH /finance/payments/:paymentId/reject
   * Reject a payment across any building in the tenant
   */
  @Patch('payments/:paymentId/reject')
  async rejectPayment(
    @Param('paymentId') paymentId: string,
    @Body() dto: RejectPaymentDto,
    @Request() req: AuthenticatedRequest,
    @Headers('x-portal-context') portalContext?: string,
  ): Promise<PaymentDetailDto> {
    const tenantId = req.tenantId!;
    const userRoles = req.user.roles || [];
    const membershipId = req.user.membershipId || '';
    this.assertAdministrativePortalAccess(userRoles, portalContext);
    return this.finanzasService.rejectPaymentTenant(
      tenantId,
      paymentId,
      userRoles,
      membershipId,
      dto,
    );
  }

  /**
   * GET /finance/payments/metrics
   * Get operational metrics for payment review (backlog, aging, approval rate, etc.)
   */
  @Get('payments/metrics')
  async getPaymentMetrics(
    @Query() query: PaymentMetricsQueryDto,
    @Request() req: AuthenticatedRequest,
    @Headers('x-portal-context') portalContext?: string,
  ): Promise<PaymentMetricsDto> {
    const tenantId = req.tenantId!;
    this.assertAdministrativePortalAccess(req.user.roles || [], portalContext);
    return this.finanzasService.getPaymentMetrics(tenantId, query);
  }

  /**
   * GET /finance/payments/:paymentId/audit
   * Get audit history for a specific payment
   */
  @Get('payments/:paymentId/audit')
  async getPaymentAuditLog(
    @Param('paymentId') paymentId: string,
    @Query() query: GetPaymentAuditLogQuery,
    @Request() req: AuthenticatedRequest,
    @Headers('x-portal-context') portalContext?: string,
  ): Promise<PaymentAuditLogDto[]> {
    const tenantId = req.tenantId!;
    this.assertAdministrativePortalAccess(req.user.roles || [], portalContext);
    return this.finanzasService.getPaymentAuditLog(tenantId, paymentId, query);
  }

  /**
   * GET /finance/payments/:paymentId/duplicate-check
   * Check for potential duplicate payments
   */
  @Get('payments/:paymentId/duplicate-check')
  async checkPaymentDuplicate(
    @Param('paymentId') paymentId: string,
    @Request() req: AuthenticatedRequest,
    @Headers('x-portal-context') portalContext?: string,
  ): Promise<PaymentDuplicateCheckResultDto> {
    const tenantId = req.tenantId!;
    this.assertAdministrativePortalAccess(req.user.roles || [], portalContext);
    return this.finanzasService.checkPaymentDuplicate(tenantId, paymentId);
  }

  /**
   * POST /finance/payments/:paymentId/retry-receipt
   * Retry generating a receipt for an approved payment (if previous attempt failed)
   */
  @Post('payments/:paymentId/retry-receipt')
  async retryReceiptGeneration(
    @Param('paymentId') paymentId: string,
    @Request() req: AuthenticatedRequest,
    @Headers('x-portal-context') portalContext?: string,
  ) {
    const tenantId = req.tenantId!;
    const userRoles = req.user.roles || [];
    this.assertAdministrativePortalAccess(userRoles, portalContext);
    return this.finanzasService.retryReceiptGeneration(tenantId, paymentId, userRoles, req.user.id);
  }
}
