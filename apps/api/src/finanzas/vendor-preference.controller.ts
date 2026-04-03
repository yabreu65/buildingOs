import { Controller, Get, Post, Delete, Param, Body, Request, UseGuards } from '@nestjs/common';
import { VendorPreferenceService } from './vendor-preference.service';
import { AuthenticatedRequest } from '../common/types/request.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';

@Controller('tenants/:tenantId/finance/vendor-preferences')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class VendorPreferenceController {
  constructor(private readonly vendorPreferenceService: VendorPreferenceService) {}

  @Get()
  async list(@Request() req: AuthenticatedRequest) {
    return this.vendorPreferenceService.listPreferences(req.tenantId!, req.user.roles ?? []);
  }

  @Post()
  async set(
    @Request() req: AuthenticatedRequest,
    @Body() body: { categoryId: string; vendorId: string },
  ) {
    return this.vendorPreferenceService.setPreference(
      req.tenantId!,
      body.categoryId,
      body.vendorId,
      req.user.roles ?? [],
    );
  }

  @Delete(':categoryId')
  async delete(
    @Request() req: AuthenticatedRequest,
    @Param('categoryId') categoryId: string,
  ) {
    await this.vendorPreferenceService.deletePreference(
      req.tenantId!,
      categoryId,
      req.user.roles ?? [],
    );
    return { success: true };
  }

  @Get('suggest/:categoryId')
  async suggest(
    @Request() req: AuthenticatedRequest,
    @Param('categoryId') categoryId: string,
  ) {
    return this.vendorPreferenceService.getVendorSuggestion(req.tenantId!, categoryId);
  }
}
