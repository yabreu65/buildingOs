import {
  Controller,
  Get,
  Query,
  UseGuards,
  Request,
  BadRequestException,
  Headers,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto, DashboardSummaryDto } from './dashboard.dto';
import { AuthenticatedRequest } from '../common/types/request.types';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { hasAdministrativePortalAccess } from '../common/portal-context';

@ApiTags('Dashboard')
@Controller('tenants/:tenantId/dashboard')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  private assertAdministrativePortalAccess(
    userRoles: readonly string[],
    portalContext?: string,
  ): void {
    if (!hasAdministrativePortalAccess(userRoles, portalContext)) {
      throw new ForbiddenException('Solo administradores pueden consultar esta información');
    }
  }

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
    @Headers('x-portal-context') portalContext?: string,
  ): Promise<DashboardSummaryDto> {
    const tenantId = req.tenantId;
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    this.assertAdministrativePortalAccess(req.user.roles || [], portalContext);
    return this.dashboardService.getSummary(tenantId, query);
  }
}
