import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
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
import { resolveTenantMembershipContext } from '../common/request-context';
import { ExpenseLedgerCategoriesService } from './expense-ledger-categories.service';
import {
  CreateExpenseLedgerCategoryDto,
  ExpenseLedgerCategoryParamDto,
  ExpenseLedgerCategoryQueryDto,
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
    @Query() query: ExpenseLedgerCategoryQueryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ExpenseLedgerCategoryResponseDto[]> {
    const context = this.resolveRequestContext(req);

    return this.categoriesService.listCategories(
      context.tenantId,
      context.membershipId,
      query.movementType,
      query.catalogScope,
    );
  }

  @Get(':categoryId')
  async getCategory(
    @Param() params: ExpenseLedgerCategoryParamDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ExpenseLedgerCategoryResponseDto> {
    const context = this.resolveRequestContext(req);

    return this.categoriesService.getCategory(
      context.tenantId,
      params.categoryId,
      context.membershipId,
    );
  }

  @Post()
  async createCategory(
    @Body() dto: CreateExpenseLedgerCategoryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ExpenseLedgerCategoryResponseDto> {
    const context = this.resolveRequestContext(req);

    return this.categoriesService.createCategory(
      context.tenantId,
      context.membershipId,
      dto,
    );
  }

  @Patch(':categoryId')
  async updateCategory(
    @Param() params: ExpenseLedgerCategoryParamDto,
    @Body() dto: UpdateExpenseLedgerCategoryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ExpenseLedgerCategoryResponseDto> {
    const context = this.resolveRequestContext(req);

    return this.categoriesService.updateCategory(
      context.tenantId,
      params.categoryId,
      context.membershipId,
      dto,
    );
  }

  @Delete(':categoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCategory(
    @Param() params: ExpenseLedgerCategoryParamDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    const context = this.resolveRequestContext(req);

    return this.categoriesService.deleteCategory(
      context.tenantId,
      params.categoryId,
      context.membershipId,
    );
  }

  private resolveRequestContext(req: AuthenticatedRequest): {
    tenantId: string;
    membershipId: string;
  } {
    const { tenantId, membershipId } = resolveTenantMembershipContext(req);
    return { tenantId, membershipId };
  }
}
