import { Controller, Get, Query, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto, DashboardSummaryDto } from './dashboard.dto';
import { AuthenticatedRequest } from '../common/types/request.types';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Dashboard')
@Controller('dashboard')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * Get admin dashboard summary for the current tenant and period.
   *
   * @param query - Period and optional building filter
   * @param req - Authenticated request with tenantId
   * @throws BadRequestException if tenantId is not resolved
   */
  @Get('admin')
  @ApiOperation({ summary: 'Get admin dashboard summary' })
  @ApiResponse({ status: 200, description: 'Dashboard summary returned' })
  async getAdminSummary(
    @Query() query: DashboardQueryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<DashboardSummaryDto> {
    const tenantId = req.tenantId;
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    return this.dashboardService.getSummary(tenantId, query);
  }
}
