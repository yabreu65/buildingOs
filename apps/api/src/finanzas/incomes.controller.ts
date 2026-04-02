import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { AuthenticatedRequest } from '../common/types/request.types';
import { IncomesService } from './incomes.service';
import {
  CreateIncomeDto,
  UpdateIncomeDto,
  IncomeResponseDto,
} from './expense-ledger.dto';

/**
 * Movimientos de ingresos (tenant-scoped)
 * Routes: /tenants/:tenantId/finance/incomes
 */
@Controller('tenants/:tenantId/finance/incomes')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class IncomesController {
  constructor(private readonly incomesService: IncomesService) {}

  @Get()
  async listIncomes(
    @Query('buildingId') buildingId?: string,
    @Query('period') period?: string,
    @Query('categoryId') categoryId?: string,
    @Request() req?: AuthenticatedRequest,
  ): Promise<IncomeResponseDto[]> {
    return this.incomesService.listIncomes(req!.tenantId!, req!.user.roles ?? [], {
      buildingId,
      period,
      categoryId,
    });
  }

  @Get(':incomeId')
  async getIncome(
    @Param('incomeId') incomeId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<IncomeResponseDto> {
    return this.incomesService.getIncome(
      req.tenantId!,
      incomeId,
      req.user.roles ?? [],
    );
  }

  @Post()
  async createIncome(
    @Body() dto: CreateIncomeDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<IncomeResponseDto> {
    return this.incomesService.createIncome(
      req.tenantId!,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
      dto,
    );
  }

  @Patch(':incomeId')
  async updateIncome(
    @Param('incomeId') incomeId: string,
    @Body() dto: UpdateIncomeDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<IncomeResponseDto> {
    return this.incomesService.updateIncome(
      req.tenantId!,
      incomeId,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
      dto,
    );
  }

  @Post(':incomeId/record')
  async recordIncome(
    @Param('incomeId') incomeId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<IncomeResponseDto> {
    return this.incomesService.recordIncome(
      req.tenantId!,
      incomeId,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
    );
  }

  @Post(':incomeId/void')
  @HttpCode(HttpStatus.OK)
  async voidIncome(
    @Param('incomeId') incomeId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<IncomeResponseDto> {
    return this.incomesService.voidIncome(
      req.tenantId!,
      incomeId,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
    );
  }
}
