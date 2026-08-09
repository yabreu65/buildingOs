import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/types/request.types';
import { RequireTenantPermission } from '../rbac/tenant-permission.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { CreateExchangeRateDto, ExchangeRateQueryDto, UpdateExchangeRateDto, UpdateFinanceSettingsDto } from './multicurrency.dto';
import { MulticurrencyService } from './multicurrency.service';

@Controller('tenants/:tenantId/finance')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class MulticurrencyController {
  constructor(private readonly multicurrency: MulticurrencyService) {}

  @Get('settings')
  @RequireTenantPermission('finance.settings.read')
  getSettings(@Param('tenantId') tenantId: string) { return this.multicurrency.getSettings(tenantId); }

  @Patch('settings')
  @RequireTenantPermission('finance.settings.write')
  updateSettings(@Param('tenantId') tenantId: string, @Body() dto: UpdateFinanceSettingsDto) { return this.multicurrency.updateSettings(tenantId, dto.functionalCurrency); }

  @Get('exchange-rates')
  @RequireTenantPermission('finance.settings.read')
  list(@Param('tenantId') tenantId: string, @Query() query: ExchangeRateQueryDto) { return this.multicurrency.list(tenantId, query); }

  @Post('exchange-rates')
  @RequireTenantPermission('finance.settings.write')
  create(@Param('tenantId') tenantId: string, @Body() dto: CreateExchangeRateDto, @Request() req: AuthenticatedRequest) { return this.multicurrency.create(tenantId, req.user.membershipId, dto); }

  @Patch('exchange-rates/:exchangeRateId')
  @RequireTenantPermission('finance.settings.write')
  update(@Param('tenantId') tenantId: string, @Param('exchangeRateId') id: string, @Body() dto: UpdateExchangeRateDto) { return this.multicurrency.update(tenantId, id, dto); }
}
