import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FinanzasService } from './finanzas.service';
import { AuthenticatedRequest } from '../common/types/request.types';
import { FinancialSummaryQueryDto, FinancialSummaryDto, FinanceTrendQueryDto, MonthlyTrendDto } from './finanzas.dto';

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
   * GET /finance/trend?months=6
   * Get monthly trend of charges, payments, outstanding, collection rate
   * Aggregated across all buildings for the tenant
   */
  @Get('trend')
  async getFinanceTrend(
    @Query() query: FinanceTrendQueryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<MonthlyTrendDto[]> {
    const tenantId = req.tenantId!;
    return this.finanzasService.getFinanceTrend(
      tenantId,
      null, // null = tenant-level aggregation
      query.months || 6,
    );
  }
}
