import {
  Controller,
  Get,
  Query,
  UseGuards,
  BadRequestException,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../common/types/request.types';
import { MovementAllocationService } from './movement-allocation.service';

@Controller('tenants/:tenantId/allocations')
@UseGuards(JwtAuthGuard)
export class MovementAllocationController {
  constructor(private readonly allocationService: MovementAllocationService) {}

  /**
   * Get allocations for a specific expense or income
   * Query: ?expenseId=... OR ?incomeId=...
   */
  @Get()
  async getAllocations(
    @Request() req: AuthenticatedRequest,
    @Query('expenseId') expenseId?: string,
    @Query('incomeId') incomeId?: string,
  ) {
    const tenantId = req.tenantId || req.user?.tenantId;

    if (!tenantId) {
      throw new Error('Missing tenantId in request');
    }

    if (!expenseId && !incomeId) {
      throw new BadRequestException(
        'Se requiere expenseId o incomeId como parámetro de query',
      );
    }

    if (expenseId && incomeId) {
      throw new BadRequestException(
        'No se pueden usar expenseId e incomeId al mismo tiempo',
      );
    }

    return this.allocationService.getAllocations(
      tenantId,
      expenseId,
      incomeId,
    );
  }
}
