import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  Request,
  ForbiddenException,
  Query,
} from '@nestjs/common';
import type { Role } from '@buildingos/contracts';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { RecurringExpenseService } from './recurring-expense.service';
import { StrictBooleanInterceptor } from './strict-boolean.interceptor';
import { AuthenticatedRequest } from '../common/types/request.types';
import {
  CreateRecurringExpenseDto,
  UpdateRecurringExpenseDto,
  RecurringExpenseDto,
} from './recurring-expense.dto';

/**
 * TenantRecurringExpenseController: CRUD for tenant-shared recurring expense templates
 * Only admins/operators can create/update recurring expenses
 * Handles TENANT_SHARED scope (multi-building expenses with allocations)
 */
@Controller('tenants/:tenantId/recurring-expenses')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class TenantRecurringExpenseController {
  private readonly adminRoles: readonly Role[] = [
    'TENANT_ADMIN',
    'TENANT_OWNER',
    'OPERATOR',
  ];

  constructor(private recurringExpenseService: RecurringExpenseService) {}

  /**
   * POST /tenants/:tenantId/recurring-expenses
   * Create a new tenant-shared recurring expense template
   */
  @Post()
  async createRecurringExpense(
    @Param('tenantId') tenantId: string,
    @Body() createDto: CreateRecurringExpenseDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<RecurringExpenseDto> {
    const userRoles = req.user?.roles || [];

    // Only TENANT_ADMIN, TENANT_OWNER, OPERATOR can create
    if (!this.adminRoles.some((role) => userRoles.includes(role))) {
      throw new ForbiddenException('Solo administradores pueden crear gastos recurrentes');
    }

    return this.recurringExpenseService.createRecurringExpense(
      tenantId,
      createDto,
    );
  }

  /**
   * GET /tenants/:tenantId/recurring-expenses
   * List tenant-shared recurring expense templates
   */
  @Get()
  async listRecurringExpenses(
    @Param('tenantId') tenantId: string,
    @Query('includeInactive') includeInactive: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<RecurringExpenseDto[]> {
    const shouldIncludeInactive = includeInactive === 'true';

    // List TENANT_SHARED scope only
    return this.recurringExpenseService.listRecurringExpenses(
      tenantId,
      undefined,
      shouldIncludeInactive,
      'TENANT_SHARED',
    );
  }

  /**
   * PATCH /tenants/:tenantId/recurring-expenses/:id
   * Update a tenant-shared recurring expense template
   */
  @Patch(':id')
  @UseInterceptors(new StrictBooleanInterceptor())
  async updateRecurringExpense(
    @Param('tenantId') tenantId: string,
    @Param('id') recurringId: string,
    @Body() updateDto: UpdateRecurringExpenseDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<RecurringExpenseDto> {
    const userRoles = req.user?.roles || [];

    // Only TENANT_ADMIN, TENANT_OWNER, OPERATOR can update
    if (!this.adminRoles.some((role) => userRoles.includes(role))) {
      throw new ForbiddenException('Solo administradores pueden modificar gastos recurrentes');
    }

    return this.recurringExpenseService.updateRecurringExpense(
      tenantId,
      recurringId,
      updateDto,
      { scopeType: 'TENANT_SHARED', buildingId: null },
    );
  }
}
