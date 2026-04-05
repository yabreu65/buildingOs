import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BuildingAccessGuard } from '../tenancy/building-access.guard';
import { RecurringExpenseService } from './recurring-expense.service';
import { AuthenticatedRequest } from '../common/types/request.types';
import {
  CreateRecurringExpenseDto,
  UpdateRecurringExpenseDto,
  RecurringExpenseDto,
} from './recurring-expense.dto';

/**
 * RecurringExpenseController: CRUD for recurring expense templates
 * Only admins/operators can create/update recurring expenses
 */
@Controller('buildings/:buildingId/recurring-expenses')
@UseGuards(JwtAuthGuard, BuildingAccessGuard)
export class RecurringExpenseController {
  constructor(private recurringExpenseService: RecurringExpenseService) {}

  /**
   * POST /buildings/:buildingId/recurring-expenses
   * Create a new recurring expense template
   */
  @Post()
  async createRecurringExpense(
    @Param('buildingId') buildingId: string,
    @Body() createDto: CreateRecurringExpenseDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<RecurringExpenseDto> {
    const tenantId = req.tenantId!;
    const userRoles = req.user?.roles || [];

    // Only TENANT_ADMIN, TENANT_OWNER, OPERATOR can create
    if (
      !['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'].some((role) =>
        userRoles.includes(role),
      )
    ) {
      throw new ForbiddenException('Solo administradores pueden crear gastos recurrentes');
    }

    return this.recurringExpenseService.createRecurringExpense(
      tenantId,
      buildingId,
      createDto,
    );
  }

  /**
   * GET /buildings/:buildingId/recurring-expenses
   * List recurring expense templates for a building
   */
  @Get()
  async listRecurringExpenses(
    @Param('buildingId') buildingId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<RecurringExpenseDto[]> {
    const tenantId = req.tenantId!;
    return this.recurringExpenseService.listRecurringExpenses(
      tenantId,
      buildingId,
      false, // Only active by default
    );
  }

  /**
   * PATCH /buildings/:buildingId/recurring-expenses/:id
   * Update a recurring expense template (enable/disable or modify)
   */
  @Patch(':id')
  async updateRecurringExpense(
    @Param('buildingId') buildingId: string,
    @Param('id') recurringId: string,
    @Body() updateDto: UpdateRecurringExpenseDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<RecurringExpenseDto> {
    const tenantId = req.tenantId!;
    const userRoles = req.user?.roles || [];

    // Only TENANT_ADMIN, TENANT_OWNER, OPERATOR can update
    if (
      !['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'].some((role) =>
        userRoles.includes(role),
      )
    ) {
      throw new ForbiddenException('Solo administradores pueden modificar gastos recurrentes');
    }

    return this.recurringExpenseService.updateRecurringExpense(
      tenantId,
      recurringId,
      updateDto,
    );
  }
}
