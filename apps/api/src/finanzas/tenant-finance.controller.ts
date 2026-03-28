import { Controller, Get, Patch, Param, Query, UseGuards, Request, Body, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FinanzasService } from './finanzas.service';
import { AuthenticatedRequest } from '../common/types/request.types';
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
} from './finanzas.dto';
import { Payment } from '@prisma/client';

interface GetPaymentAuditLogQuery { limit?: number }

/**
 * TenantFinanceController: Tenant-level (aggregated) finance endpoints
 * Routes: /finance/*
 *
 * Security:
 * 1. JwtAuthGuard: Requires valid JWT token
 * 2. Auto-scoped to req.tenantId (from JWT claims)
 * 3. No additional building validation needed (aggregates all buildings for tenant)
 */
@Controller('finance')
@UseGuards(JwtAuthGuard)
export class TenantFinanceController {
  constructor(private finanzasService: FinanzasService) {}

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
  ): Promise<FinancialSummaryDto> {
    const tenantId = req.tenantId!;
    return this.finanzasService.getTenantFinancialSummary(
      tenantId,
      query.period || undefined,
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
  ): Promise<Payment[]> {
    const tenantId = req.tenantId!;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
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
  ): Promise<Payment> {
    const tenantId = req.tenantId!;
    const userRoles = req.user.roles || [];
    const membershipId = req.user.membershipId || '';
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
  ): Promise<Payment> {
    const tenantId = req.tenantId!;
    const userRoles = req.user.roles || [];
    const membershipId = req.user.membershipId || '';
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
  ): Promise<PaymentMetricsDto> {
    const tenantId = req.tenantId!;
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
  ): Promise<PaymentAuditLogDto[]> {
    const tenantId = req.tenantId!;
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
  ): Promise<PaymentDuplicateCheckResultDto> {
    const tenantId = req.tenantId!;
    return this.finanzasService.checkPaymentDuplicate(tenantId, paymentId);
  }
}
