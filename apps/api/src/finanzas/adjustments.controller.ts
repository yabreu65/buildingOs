import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { AuthenticatedRequest } from '../common/types/request.types';
import { AdjustmentsService } from './adjustments.service';
import { CreateAdjustmentDto } from './expense-ledger.dto';

class ListAdjustmentsQuery {
  @IsOptional()
  @IsString()
  buildingId?: string;

  @IsOptional()
  @IsString()
  targetPeriod?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

@Controller('tenants/:tenantId/finance/adjustments')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class AdjustmentsController {
  constructor(private readonly adjustmentsService: AdjustmentsService) {}

  @Post()
  async createAdjustment(
    @Body() dto: CreateAdjustmentDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.adjustmentsService.createAdjustment(
      req.tenantId!,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
      dto,
    );
  }

  @Post(':adjustmentId/validate')
  async validateAdjustment(
    @Param('adjustmentId') adjustmentId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.adjustmentsService.validateAdjustment(
      req.tenantId!,
      adjustmentId,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
    );
  }

  @Get()
  async listAdjustments(
    @Query() query: ListAdjustmentsQuery,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.adjustmentsService.listAdjustments(
      req.tenantId!,
      req.user.roles ?? [],
      {
        buildingId: query.buildingId,
        targetPeriod: query.targetPeriod,
        status: query.status as any,
      },
    );
  }
}