import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { AuthenticatedRequest } from '../common/types/request.types';
import { ExpenseReportsService } from './expense-reports.service';

class NotasRevelatoriasQuery {
  @IsOptional()
  @IsString()
  period?: string;
}

@Controller('tenants/:tenantId/finance/reports')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class ExpenseReportsController {
  constructor(private readonly reportsService: ExpenseReportsService) {}

  /**
   * Monthly expense history: totals per period, broken down by building.
   * Includes BUILDING-scope expenses and each building's share of TENANT_SHARED.
   */
  @Get('expenses')
  async getExpenseHistory(@Request() req: AuthenticatedRequest) {
    return this.reportsService.getExpenseHistory(
      req.tenantId!,
      req.user.roles ?? [],
    );
  }

  @Get('notas-revelatorias')
  async getNotasRevelatorias(
    @Query() query: NotasRevelatoriasQuery,
    @Request() req: AuthenticatedRequest,
  ) {
    const period =
      query.period ?? new Date().toISOString().slice(0, 7); // default: current month
    return this.reportsService.getNotasRevelatorias(
      req.tenantId!,
      period,
      req.user.roles ?? [],
    );
  }
}
