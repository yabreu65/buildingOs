import {
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  BadRequestException,
  UnauthorizedException,
  Request,
} from '@nestjs/common';
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { AuthenticatedRequest } from '../common/types/request.types';
import { MovementAllocationService } from './movement-allocation.service';

export class GetAllocationsQueryDto {
  @IsString()
  @IsOptional()
  expenseId?: string;

  @IsString()
  @IsOptional()
  incomeId?: string;
}

export class SuggestAllocationsQueryDto {
  @IsString()
  @IsOptional()
  period?: string;

  @IsEnum(['BUILDING_TOTAL_M2', 'EQUAL_SHARE'])
  @IsOptional()
  mode?: 'BUILDING_TOTAL_M2' | 'EQUAL_SHARE';
}

interface BuildingM2Summary {
  buildingId: string;
  buildingName: string;
  totalM2: number;
  percentage: number;
}

@Controller('tenants/:tenantId/allocations')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class MovementAllocationController {
  constructor(private readonly allocationService: MovementAllocationService) {}

  /**
   * Get allocations for a specific expense or income
   * @param req Authenticated request with tenantId
   * @param query Query parameters (expenseId OR incomeId, not both)
   * @returns Array of movement allocations with building details
   */
  @Get()
  async getAllocations(
    @Request() req: AuthenticatedRequest,
    @Query() query: GetAllocationsQueryDto,
  ) {
    const tenantId = req.tenantId || req.user?.tenantId;

    if (!tenantId) {
      throw new UnauthorizedException('Missing tenantId in request context');
    }

    if (!query.expenseId && !query.incomeId) {
      throw new BadRequestException(
        'Se requiere expenseId o incomeId como parámetro de query',
      );
    }

    if (query.expenseId && query.incomeId) {
      throw new BadRequestException(
        'No se pueden usar expenseId e incomeId al mismo tiempo',
      );
    }

    return this.allocationService.getAllocations(
      tenantId,
      query.expenseId,
      query.incomeId,
    );
  }

  /**
   * Suggest allocations based on building total m²
   * Returns suggested percentages for each building in the tenant
   * @param req Authenticated request with tenantId
   * @param query Query parameters (period, mode)
   * @returns Array of building allocations with calculated percentages
   */
  @Get('suggest')
  async suggestAllocations(
    @Request() req: AuthenticatedRequest,
    @Query() query: SuggestAllocationsQueryDto,
  ): Promise<BuildingM2Summary[]> {
    const tenantId = req.tenantId || req.user?.tenantId;

    if (!tenantId) {
      throw new UnauthorizedException('Missing tenantId in request context');
    }

    const mode = query.mode || 'BUILDING_TOTAL_M2';

    return this.allocationService.suggestAllocationsByMode(tenantId, mode);
  }
}
