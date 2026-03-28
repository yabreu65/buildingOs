import { Controller, Get, Query, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto, DashboardSummaryDto } from './dashboard.dto';
import { AuthenticatedRequest } from '../common/types/request.types';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Dashboard')
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('admin')
  @ApiOperation({ summary: 'Get admin dashboard summary' })
  @ApiResponse({ status: 200, description: 'Dashboard summary returned' })
  async getAdminSummary(
    @Query() query: DashboardQueryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<DashboardSummaryDto> {
    const tenantId = req.tenantId ?? req.user.memberships?.[0]?.tenantId;
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    return this.dashboardService.getSummary(tenantId, query);
  }
}
