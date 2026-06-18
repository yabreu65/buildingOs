import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { TenantContextRequest } from '../common/types/request.types';
import { BillingService } from './billing.service';
import { CancelPlanChangeRequestDto } from './dto/cancel-plan-change-request.dto';
import { CreatePlanChangeRequestDto } from './dto/create-plan-change-request.dto';

@UseGuards(JwtAuthGuard, TenantAccessGuard)
@Controller('tenants/:tenantId/billing/plan-change-requests')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  /**
   * Create a plan change request
   */
  @Post()
  create(@Req() req: TenantContextRequest, @Body() dto: CreatePlanChangeRequestDto) {
    return this.billingService.createPlanChangeRequest(req.user, dto);
  }

  /**
   * List plan change requests for tenant
   */
  @Get()
  list(@Req() req: TenantContextRequest) {
    return this.billingService.listTenantPlanChangeRequests(
      req.user,
      req.tenantId,
    );
  }

  /**
   * Cancel a plan change request
   */
  @Post(':id/cancel')
  cancel(
    @Req() req: TenantContextRequest,
    @Param('id') id: string,
    @Body() body: CancelPlanChangeRequestDto,
  ) {
    return this.billingService.cancelPlanChangeRequest(req.user, req.tenantId, id);
  }
}
