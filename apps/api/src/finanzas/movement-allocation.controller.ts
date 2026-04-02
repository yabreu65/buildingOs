import {
  Controller,
  Get,
  Query,
  UseGuards,
  BadRequestException,
  UnauthorizedException,
  Request,
} from '@nestjs/common';
import { IsString, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
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

@Controller('tenants/:tenantId/allocations')
@UseGuards(JwtAuthGuard)
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
}
