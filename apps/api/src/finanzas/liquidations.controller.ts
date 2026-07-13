import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../common/types/request.types';
import { resolveTenantMembershipContext } from '../common/request-context';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import {
  CancelLiquidationDto,
  CreateLiquidationDraftDto,
  ListLiquidationsQueryDto,
  LiquidationDetailDto,
  LiquidationParamDto,
  LiquidationResponseDto,
  PublishLiquidationDto,
} from './expense-ledger.dto';
import { LiquidationsService } from './liquidations.service';

@Controller('tenants/:tenantId/finance/liquidations')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class LiquidationsController {
  constructor(private readonly liquidationsService: LiquidationsService) {}

  @Get()
  async listLiquidations(
    @Query() query: ListLiquidationsQueryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<LiquidationResponseDto[]> {
    const context = this.resolveRequestContext(req);

    return this.liquidationsService.listLiquidations(
      context.tenantId,
      context.membershipId,
      context.roles,
      { buildingId: query.buildingId, period: query.period },
    );
  }

  @Get(':liquidationId')
  async getLiquidation(
    @Param() params: LiquidationParamDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<LiquidationDetailDto> {
    const context = this.resolveRequestContext(req);

    return this.liquidationsService.getLiquidation(
      context.tenantId,
      params.liquidationId,
      context.membershipId,
      context.roles,
    );
  }

  @Post('draft')
  async createDraft(
    @Body() dto: CreateLiquidationDraftDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<LiquidationDetailDto> {
    const context = this.resolveRequestContext(req);

    return this.liquidationsService.createDraft(
      context.tenantId,
      context.membershipId,
      context.roles,
      dto,
    );
  }

  @Post(':liquidationId/review')
  @HttpCode(HttpStatus.OK)
  async reviewLiquidation(
    @Param() params: LiquidationParamDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<LiquidationResponseDto> {
    const context = this.resolveRequestContext(req);

    return this.liquidationsService.reviewLiquidation(
      context.tenantId,
      params.liquidationId,
      context.membershipId,
      context.roles,
    );
  }

  @Post(':liquidationId/publish')
  @HttpCode(HttpStatus.OK)
  async publishLiquidation(
    @Param() params: LiquidationParamDto,
    @Body() dto: PublishLiquidationDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<LiquidationResponseDto> {
    const context = this.resolveRequestContext(req);

    return this.liquidationsService.publishLiquidation(
      context.tenantId,
      params.liquidationId,
      context.membershipId,
      context.roles,
      dto,
    );
  }

  @Post(':liquidationId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelLiquidation(
    @Param() params: LiquidationParamDto,
    @Body() dto: CancelLiquidationDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<LiquidationResponseDto> {
    const context = this.resolveRequestContext(req);

    return this.liquidationsService.cancelLiquidation(
      context.tenantId,
      params.liquidationId,
      context.membershipId,
      context.roles,
      { reason: dto.reason },
    );
  }

  private resolveRequestContext(req: AuthenticatedRequest): {
    tenantId: string;
    membershipId: string;
    roles: string[];
  } {
    return resolveTenantMembershipContext(req);
  }
}
