import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BillingService } from './billing.service';
import { CancelPlanChangeRequestDto } from './dto/cancel-plan-change-request.dto';
import { CreatePlanChangeRequestDto } from './dto/create-plan-change-request.dto';
import { ListPlanChangeRequestsDto } from './dto/list-plan-change-requests.dto';

@UseGuards(JwtAuthGuard)
@Controller('billing/plan-change-requests')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post()
  create(@Request() req: ExpressRequest, @Body() dto: CreatePlanChangeRequestDto) {
    return this.billingService.createPlanChangeRequest((req as any).user, dto);
  }

  @Get()
  list(@Request() req: ExpressRequest, @Query() query: ListPlanChangeRequestsDto) {
    return this.billingService.listTenantPlanChangeRequests(
      (req as any).user,
      query.tenantId,
    );
  }

  @Post(':id/cancel')
  cancel(
    @Request() req: ExpressRequest,
    @Param('id') id: string,
    @Body() body: CancelPlanChangeRequestDto,
  ) {
    return this.billingService.cancelPlanChangeRequest((req as any).user, body.tenantId, id);
  }
}
