import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BuildingAccessGuard } from '../tenancy/building-access.guard';
import { AuthenticatedRequest } from '../common/types/request.types';
import { ExpenseCategoriesService } from './expense-categories.service';
import {
  CreateUnitCategoryParamDto,
  ListUnitCategoriesParamDto,
  GetUnitCategoryParamDto,
  UpdateUnitCategoryParamDto,
  DeleteUnitCategoryParamDto,
  AutoAssignUnitsParamDto,
  AutoAssignPreviewParamDto,
  CreateUnitCategoryDto,
  UpdateUnitCategoryDto,
  AutoAssignUnitsDto,
  AutoAssignPreviewDto,
  UnitCategoryDto,
  AutoAssignResultDto,
} from './expense-categories.dto';

@Controller('buildings/:buildingId/expense-categories')
@UseGuards(JwtAuthGuard, BuildingAccessGuard)
export class ExpenseCategoriesController {
  constructor(private categoriesService: ExpenseCategoriesService) {}

  /**
   * GET /buildings/:buildingId/expense-categories
   * List all unit categories for a building
   */
  @Get()
  async listCategories(
    @Param() params: ListUnitCategoriesParamDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<UnitCategoryDto[]> {
    const tenantId = req.tenantId!;
    const userRoles = req.user.roles || [];
    return this.categoriesService.listCategories(
      tenantId,
      params.buildingId,
      userRoles,
    );
  }

  /**
   * POST /buildings/:buildingId/expense-categories
   * Create a new unit category
   */
  @Post()
  @HttpCode(201)
  async createCategory(
    @Param() params: CreateUnitCategoryParamDto,
    @Body() dto: CreateUnitCategoryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<UnitCategoryDto> {
    const tenantId = req.tenantId!;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    return this.categoriesService.createCategory(
      tenantId,
      params.buildingId,
      userRoles,
      userId,
      dto,
    );
  }

  /**
   * GET /buildings/:buildingId/expense-categories/:categoryId
   * Get a specific category
   */
  @Get(':categoryId')
  async getCategory(
    @Param() params: GetUnitCategoryParamDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<UnitCategoryDto> {
    const tenantId = req.tenantId!;
    const userRoles = req.user.roles || [];
    return this.categoriesService.getCategory(
      tenantId,
      params.buildingId,
      params.categoryId,
      userRoles,
    );
  }

  /**
   * PATCH /buildings/:buildingId/expense-categories/:categoryId
   * Update a unit category
   */
  @Patch(':categoryId')
  async updateCategory(
    @Param() params: UpdateUnitCategoryParamDto,
    @Body() dto: UpdateUnitCategoryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<UnitCategoryDto> {
    const tenantId = req.tenantId!;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    return this.categoriesService.updateCategory(
      tenantId,
      params.buildingId,
      params.categoryId,
      userRoles,
      userId,
      dto,
    );
  }

  /**
   * DELETE /buildings/:buildingId/expense-categories/:categoryId
   * Soft-delete a unit category (set active = false)
   */
  @Delete(':categoryId')
  @HttpCode(204)
  async deleteCategory(
    @Param() params: DeleteUnitCategoryParamDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    const tenantId = req.tenantId!;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    return this.categoriesService.deleteCategory(
      tenantId,
      params.buildingId,
      params.categoryId,
      userRoles,
      userId,
    );
  }

  /**
   * POST /buildings/:buildingId/expense-categories/auto-assign
   * Auto-assign all billable units to categories (save changes)
   */
  @Post('auto-assign')
  async autoAssignUnits(
    @Param() params: AutoAssignUnitsParamDto,
    @Body() dto: AutoAssignUnitsDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<AutoAssignResultDto> {
    const tenantId = req.tenantId!;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    return this.categoriesService.autoAssignUnits(
      tenantId,
      params.buildingId,
      userRoles,
      userId,
      dto.force,
    );
  }

  /**
   * POST /buildings/:buildingId/expense-categories/auto-assign/preview
   * Preview auto-assign without saving
   */
  @Post('auto-assign/preview')
  async previewAutoAssign(
    @Param() params: AutoAssignPreviewParamDto,
    @Body() dto: AutoAssignPreviewDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<AutoAssignResultDto> {
    const tenantId = req.tenantId!;
    const userRoles = req.user.roles || [];
    return this.categoriesService.previewAutoAssign(
      tenantId,
      params.buildingId,
      userRoles,
      dto.force,
    );
  }
}
