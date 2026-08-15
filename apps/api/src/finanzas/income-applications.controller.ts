import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { AuthenticatedRequest } from '../common/types/request.types';
import { IncomeApplicationsService } from './income-applications.service';
import {
  CreateIncomeApplicationsDto,
  IncomeApplicationPlanResponseDto,
} from './income-applications.dto';

/**
 * Plan de aplicaciones de un Income (tenant-scoped)
 * Routes: /tenants/:tenantId/finance/incomes/:incomeId/applications
 */
@Controller('tenants/:tenantId/finance/incomes/:incomeId/applications')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class IncomeApplicationsController {
  constructor(private readonly incomeApplicationsService: IncomeApplicationsService) {}

  @Get()
  async getPlan(
    @Param('incomeId') incomeId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<IncomeApplicationPlanResponseDto> {
    return this.incomeApplicationsService.getPlan(
      req.tenantId!,
      incomeId,
      req.user.roles ?? [],
    );
  }

  @Post()
  async createPlan(
    @Param('incomeId') incomeId: string,
    @Body() dto: CreateIncomeApplicationsDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<IncomeApplicationPlanResponseDto> {
    return this.incomeApplicationsService.createPlan(
      req.tenantId!,
      incomeId,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
      dto,
    );
  }
}
