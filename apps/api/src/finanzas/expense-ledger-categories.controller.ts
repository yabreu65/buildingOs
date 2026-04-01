import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { AuthenticatedRequest } from '../common/types/request.types';
import { ExpenseLedgerCategoriesService } from './expense-ledger-categories.service';
import {
  CreateExpenseLedgerCategoryDto,
  UpdateExpenseLedgerCategoryDto,
  ExpenseLedgerCategoryResponseDto,
} from './expense-ledger.dto';

/**
 * Rubros de gasto (tenant-scoped, reutilizables en todos los edificios)
 * Routes: /tenants/:tenantId/finance/expense-categories
 */
@Controller('tenants/:tenantId/finance/expense-categories')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class ExpenseLedgerCategoriesController {
  constructor(
    private readonly categoriesService: ExpenseLedgerCategoriesService,
  ) {}

  @Get()
  async listCategories(
    @Request() req: AuthenticatedRequest,
  ): Promise<ExpenseLedgerCategoryResponseDto[]> {
    return this.categoriesService.listCategories(
      req.tenantId!,
      req.user.roles ?? [],
    );
  }

  @Get(':categoryId')
  async getCategory(
    @Param('categoryId') categoryId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<ExpenseLedgerCategoryResponseDto> {
    return this.categoriesService.getCategory(
      req.tenantId!,
      categoryId,
      req.user.roles ?? [],
    );
  }

  @Post()
  async createCategory(
    @Body() dto: CreateExpenseLedgerCategoryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ExpenseLedgerCategoryResponseDto> {
    return this.categoriesService.createCategory(
      req.tenantId!,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
      dto,
    );
  }

  @Patch(':categoryId')
  async updateCategory(
    @Param('categoryId') categoryId: string,
    @Body() dto: UpdateExpenseLedgerCategoryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ExpenseLedgerCategoryResponseDto> {
    return this.categoriesService.updateCategory(
      req.tenantId!,
      categoryId,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
      dto,
    );
  }

  @Delete(':categoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCategory(
    @Param('categoryId') categoryId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    return this.categoriesService.deleteCategory(
      req.tenantId!,
      categoryId,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
    );
  }
}
