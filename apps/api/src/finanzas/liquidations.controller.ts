import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { AuthenticatedRequest } from '../common/types/request.types';
import { LiquidationsService } from './liquidations.service';
import {
  CreateLiquidationDraftDto,
  PublishLiquidationDto,
  LiquidationResponseDto,
  LiquidationDetailDto,
} from './expense-ledger.dto';

class ListLiquidationsQuery {
  @IsOptional()
  @IsString()
  buildingId?: string;

  @IsOptional()
  @IsString()
  period?: string;
}

/**
 * Liquidaciones de expensas
 * Routes: /tenants/:tenantId/finance/liquidations
 */
@Controller('tenants/:tenantId/finance/liquidations')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class LiquidationsController {
  constructor(private readonly liquidationsService: LiquidationsService) {}

  @Get()
  async listLiquidations(
    @Query() query: ListLiquidationsQuery,
    @Request() req: AuthenticatedRequest,
  ): Promise<LiquidationResponseDto[]> {
    return this.liquidationsService.listLiquidations(
      req.tenantId!,
      req.user.roles ?? [],
      { buildingId: query.buildingId, period: query.period },
    );
  }

  @Get(':liquidationId')
  async getLiquidation(
    @Param('liquidationId') liquidationId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<LiquidationDetailDto> {
    return this.liquidationsService.getLiquidation(
      req.tenantId!,
      liquidationId,
      req.user.roles ?? [],
    );
  }

  @Post('draft')
  async createDraft(
    @Body() dto: CreateLiquidationDraftDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<LiquidationDetailDto> {
    return this.liquidationsService.createDraft(
      req.tenantId!,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
      dto,
    );
  }

  @Post(':liquidationId/review')
  @HttpCode(HttpStatus.OK)
  async reviewLiquidation(
    @Param('liquidationId') liquidationId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<LiquidationResponseDto> {
    return this.liquidationsService.reviewLiquidation(
      req.tenantId!,
      liquidationId,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
    );
  }

  @Post(':liquidationId/publish')
  @HttpCode(HttpStatus.OK)
  async publishLiquidation(
    @Param('liquidationId') liquidationId: string,
    @Body() dto: PublishLiquidationDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<LiquidationResponseDto> {
    return this.liquidationsService.publishLiquidation(
      req.tenantId!,
      liquidationId,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
      dto,
    );
  }

  @Post(':liquidationId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelLiquidation(
    @Param('liquidationId') liquidationId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<LiquidationResponseDto> {
    return this.liquidationsService.cancelLiquidation(
      req.tenantId!,
      liquidationId,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
    );
  }
}
