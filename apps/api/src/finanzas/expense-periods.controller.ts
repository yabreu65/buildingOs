import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  Request,
} from '@nestjs/common';
import { ExpensePeriodStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BuildingAccessGuard } from '../tenancy/building-access.guard';
import { AuthenticatedRequest } from '../common/types/request.types';
import { ExpensePeriodsService } from './expense-periods.service';
import {
  CreateExpensePeriodParamDto,
  ListExpensePeriodsParamDto,
  GetExpensePeriodParamDto,
  UpdateExpensePeriodParamDto,
  DeleteExpensePeriodParamDto,
  GenerateExpensePeriodParamDto,
  PublishExpensePeriodParamDto,
  CreateExpensePeriodDto,
  UpdateExpensePeriodDto,
  GenerateExpensePeriodDto,
  PublishExpensePeriodDto,
  ListExpensePeriodsQueryDto,
  ExpensePeriodDto,
  ExpensePeriodDetailDto,
  GenerateResultDto,
} from './expense-periods.dto';

@Controller('buildings/:buildingId/expense-periods')
@UseGuards(JwtAuthGuard, BuildingAccessGuard)
export class ExpensePeriodsController {
  constructor(private periodsService: ExpensePeriodsService) {}

  /**
   * GET /buildings/:buildingId/expense-periods
   * List all expense periods for a building
   */
  @Get()
  async listPeriods(
    @Param() params: ListExpensePeriodsParamDto,
    @Query() query: ListExpensePeriodsQueryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ExpensePeriodDto[]> {
    const tenantId = req.tenantId!;
    const userRoles = req.user.roles || [];
    return this.periodsService.listPeriods(
      tenantId,
      params.buildingId,
      userRoles,
      query.year,
      query.month,
      query.status as ExpensePeriodStatus | undefined,
    );
  }

  /**
   * POST /buildings/:buildingId/expense-periods
   * Create a new expense period (status = DRAFT)
   */
  @Post()
  @HttpCode(201)
  async createPeriod(
    @Param() params: CreateExpensePeriodParamDto,
    @Body() dto: CreateExpensePeriodDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ExpensePeriodDto> {
    const tenantId = req.tenantId!;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    return this.periodsService.createPeriod(
      tenantId,
      params.buildingId,
      userRoles,
      userId,
      dto,
    );
  }

  /**
   * GET /buildings/:buildingId/expense-periods/:periodId
   * Get a specific expense period with charges
   */
  @Get(':periodId')
  async getPeriod(
    @Param() params: GetExpensePeriodParamDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ExpensePeriodDetailDto> {
    const tenantId = req.tenantId!;
    const userRoles = req.user.roles || [];
    return this.periodsService.getPeriod(
      tenantId,
      params.buildingId,
      params.periodId,
      userRoles,
    );
  }

  /**
   * PATCH /buildings/:buildingId/expense-periods/:periodId
   * Update an expense period (only DRAFT)
   */
  @Patch(':periodId')
  async updatePeriod(
    @Param() params: UpdateExpensePeriodParamDto,
    @Body() dto: UpdateExpensePeriodDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ExpensePeriodDto> {
    const tenantId = req.tenantId!;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    return this.periodsService.updatePeriod(
      tenantId,
      params.buildingId,
      params.periodId,
      userRoles,
      userId,
      dto,
    );
  }

  /**
   * DELETE /buildings/:buildingId/expense-periods/:periodId
   * Delete an expense period (only DRAFT)
   */
  @Delete(':periodId')
  @HttpCode(204)
  async deletePeriod(
    @Param() params: DeleteExpensePeriodParamDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    const tenantId = req.tenantId!;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    return this.periodsService.deletePeriod(
      tenantId,
      params.buildingId,
      params.periodId,
      userRoles,
      userId,
    );
  }

  /**
   * POST /buildings/:buildingId/expense-periods/:periodId/generate
   * Generate charges from expense period (DRAFT → GENERATED)
   */
  @Post(':periodId/generate')
  async generateCharges(
    @Param() params: GenerateExpensePeriodParamDto,
    @Body() _dto: GenerateExpensePeriodDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<GenerateResultDto> {
    const tenantId = req.tenantId!;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    return this.periodsService.generateCharges(
      tenantId,
      params.buildingId,
      params.periodId,
      userRoles,
      userId,
    );
  }

  /**
   * POST /buildings/:buildingId/expense-periods/:periodId/publish
   * Publish an expense period (GENERATED → PUBLISHED)
   */
  @Post(':periodId/publish')
  async publishPeriod(
    @Param() params: PublishExpensePeriodParamDto,
    @Body() _dto: PublishExpensePeriodDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ExpensePeriodDto> {
    const tenantId = req.tenantId!;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    return this.periodsService.publishPeriod(
      tenantId,
      params.buildingId,
      params.periodId,
      userRoles,
      userId,
    );
  }
}
