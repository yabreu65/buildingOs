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
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { AuthenticatedRequest } from '../common/types/request.types';
import { ExpensesService } from './expenses.service';
import {
  CreateExpenseDto,
  UpdateExpenseDto,
  ExpenseResponseDto,
} from './expense-ledger.dto';
import { ImportExpensesDto, ExpenseImportResult } from './expense-import.dto';

class ListExpensesQuery {
  buildingId?: string;
  period?: string;
  status?: string;
  categoryId?: string;
  scopeType?: string;
  limit?: number;
  offset?: number;
}

/**
 * Gastos/Comprobantes mensuales
 * Routes: /tenants/:tenantId/finance/expenses
 */
@Controller('tenants/:tenantId/finance/expenses')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get()
  async listExpenses(
    @Query() query: ListExpensesQuery,
    @Request() req: AuthenticatedRequest,
  ): Promise<ExpenseResponseDto[]> {
    return this.expensesService.listExpenses(
      req.tenantId!,
      req.user.roles ?? [],
      {
        buildingId: query.buildingId,
        period: query.period,
        status: query.status,
        categoryId: query.categoryId,
        scopeType: query.scopeType as 'BUILDING' | 'TENANT_SHARED' | 'UNIT_GROUP' | undefined,
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined,
      },
    );
  }

  @Get(':expenseId')
  async getExpense(
    @Param('expenseId') expenseId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<ExpenseResponseDto> {
    return this.expensesService.getExpense(
      req.tenantId!,
      expenseId,
      req.user.roles ?? [],
    );
  }

  @Post()
  async createExpense(
    @Body() dto: CreateExpenseDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ExpenseResponseDto> {
    return this.expensesService.createExpense(
      req.tenantId!,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
      dto,
    );
  }

  @Patch(':expenseId')
  async updateExpense(
    @Param('expenseId') expenseId: string,
    @Body() dto: UpdateExpenseDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ExpenseResponseDto> {
    return this.expensesService.updateExpense(
      req.tenantId!,
      expenseId,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
      dto,
    );
  }

  @Post(':expenseId/validate')
  @HttpCode(HttpStatus.OK)
  async validateExpense(
    @Param('expenseId') expenseId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<ExpenseResponseDto> {
    return this.expensesService.validateExpense(
      req.tenantId!,
      expenseId,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
    );
  }

  @Post(':expenseId/void')
  @HttpCode(HttpStatus.OK)
  async voidExpense(
    @Param('expenseId') expenseId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<ExpenseResponseDto> {
    return this.expensesService.voidExpense(
      req.tenantId!,
      expenseId,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
    );
  }

  @Post('import/from-excel')
  @HttpCode(HttpStatus.OK)
  async importFromExcel(
    @Body()
    body: {
      period: string; // YYYY-MM
      rows: Array<{
        fecha: string;
        descripcion: string;
        monto: number;
        moneda: string;
        edificio: string;
        categoria: string;
        proveedor?: string;
      }>;
    },
    @Request() req: AuthenticatedRequest,
  ): Promise<ExpenseImportResult> {
    if (!body.period || !body.rows || !Array.isArray(body.rows)) {
      throw new BadRequestException('period y rows (array) son requeridos');
    }

    const result = await this.expensesService.importExpensesFromExcel(
      req.tenantId!,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
      body.period,
      body.rows,
    );

    return {
      totalRows: body.rows.length,
      successCount: result.successCount,
      failureCount: result.failureCount,
      createdExpenses: [],
      errors: result.errors,
    };
  }
}
