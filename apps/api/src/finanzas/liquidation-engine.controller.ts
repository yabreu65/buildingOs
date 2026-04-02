import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { IsISO8601, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../common/types/request.types';
import { LiquidationEngineService } from './liquidation-engine.service';

export class CreateLiquidationDraftDto {
  @IsString()
  buildingId!: string;

  @IsString()
  period!: string; // YYYY-MM

  @IsString()
  baseCurrency!: string;
}

export class PublishLiquidationDto {
  @IsISO8601()
  dueDate!: string;
}

@Controller('tenants/:tenantId/liquidations')
@UseGuards(JwtAuthGuard)
export class LiquidationEngineController {
  constructor(private readonly liquidationEngine: LiquidationEngineService) {}

  /**
   * Create a draft liquidation for a building/period
   * Aggregates VALIDATED expenses and calculates charges using prorrateo
   * @param req Authenticated request with tenantId and membershipId
   * @param dto Building ID, period (YYYY-MM), and base currency
   * @returns Liquidation with expenses and charge preview
   */
  @Post()
  async createDraft(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateLiquidationDraftDto,
  ) {
    const tenantId = req.tenantId || req.user?.tenantId;
    const membershipId = req.user?.membershipId;
    const roles = req.user?.roles ?? [];

    if (!tenantId || !membershipId) {
      throw new UnauthorizedException(
        'Missing tenantId or membershipId in request',
      );
    }

    return this.liquidationEngine.createLiquidationDraft(
      tenantId,
      dto.buildingId,
      dto.period,
      dto.baseCurrency,
      membershipId,
      roles,
    );
  }

  /**
   * Get liquidation detail with expenses and charges
   * @param req Authenticated request with tenantId
   * @param liquidationId ID of liquidation to retrieve
   * @returns Complete liquidation detail
   */
  @Get(':liquidationId')
  async getDetail(
    @Request() req: AuthenticatedRequest,
    @Param('liquidationId') liquidationId: string,
  ) {
    const tenantId = req.tenantId || req.user?.tenantId;
    const roles = req.user?.roles ?? [];

    if (!tenantId) {
      throw new UnauthorizedException('Missing tenantId in request');
    }

    return this.liquidationEngine.getLiquidationDetail(
      tenantId,
      liquidationId,
      roles,
    );
  }

  /**
   * Review a draft liquidation → REVIEWED status
   * Locks the liquidation for final approval
   * @param req Authenticated request with tenantId and membershipId
   * @param liquidationId ID of liquidation to review
   * @returns Updated liquidation
   */
  @Patch(':liquidationId/review')
  async review(
    @Request() req: AuthenticatedRequest,
    @Param('liquidationId') liquidationId: string,
  ) {
    const tenantId = req.tenantId || req.user?.tenantId;
    const membershipId = req.user?.membershipId;
    const roles = req.user?.roles ?? [];

    if (!tenantId || !membershipId) {
      throw new UnauthorizedException(
        'Missing tenantId or membershipId in request',
      );
    }

    return this.liquidationEngine.reviewLiquidation(
      tenantId,
      liquidationId,
      membershipId,
      roles,
    );
  }

  /**
   * Publish a reviewed liquidation → PUBLISHED status
   * Creates charges for all units and locks the liquidation
   * @param req Authenticated request with tenantId and membershipId
   * @param liquidationId ID of liquidation to publish
   * @param dto Due date for generated charges
   * @returns Updated liquidation
   */
  @Patch(':liquidationId/publish')
  async publish(
    @Request() req: AuthenticatedRequest,
    @Param('liquidationId') liquidationId: string,
    @Body() dto: PublishLiquidationDto,
  ) {
    const tenantId = req.tenantId || req.user?.tenantId;
    const membershipId = req.user?.membershipId;
    const roles = req.user?.roles ?? [];

    if (!tenantId || !membershipId) {
      throw new UnauthorizedException(
        'Missing tenantId or membershipId in request',
      );
    }

    const dueDate = new Date(dto.dueDate);
    if (isNaN(dueDate.getTime())) {
      throw new BadRequestException('Invalid dueDate format (must be ISO8601)');
    }

    return this.liquidationEngine.publishLiquidation(
      tenantId,
      liquidationId,
      dueDate,
      membershipId,
      roles,
    );
  }

  /**
   * Cancel a liquidation
   * If PUBLISHED, removes all associated charges
   * @param req Authenticated request with tenantId and membershipId
   * @param liquidationId ID of liquidation to cancel
   * @returns Updated liquidation
   */
  @Patch(':liquidationId/cancel')
  async cancel(
    @Request() req: AuthenticatedRequest,
    @Param('liquidationId') liquidationId: string,
  ) {
    const tenantId = req.tenantId || req.user?.tenantId;
    const membershipId = req.user?.membershipId;
    const roles = req.user?.roles ?? [];

    if (!tenantId || !membershipId) {
      throw new UnauthorizedException(
        'Missing tenantId or membershipId in request',
      );
    }

    return this.liquidationEngine.cancelLiquidation(
      tenantId,
      liquidationId,
      membershipId,
      roles,
    );
  }
}
