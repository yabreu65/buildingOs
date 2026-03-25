import { Injectable, ConflictException, NotFoundException, BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, UnitCategory, AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import {
  CreateUnitCategoryDto,
  UpdateUnitCategoryDto,
  UnitCategoryDto,
  AutoAssignResultDto,
} from './expense-categories.dto';

@Injectable()
export class ExpenseCategoriesService {
  constructor(
    private prisma: PrismaService,
    private validators: FinanzasValidators,
    private auditService: AuditService,
  ) {}

  /**
   * List all unit categories for a building
   */
  async listCategories(
    tenantId: string,
    buildingId: string,
    userRoles: string[],
  ): Promise<UnitCategoryDto[]> {
    // Permission: TENANT_ADMIN+ can view
    if (!this.validators.canReadCharges(userRoles)) {
      this.validators.throwForbidden('unit categories', 'read');
    }

    // Validate building
    await this.validators.validateBuildingBelongsToTenant(tenantId, buildingId);

    const categories = await this.prisma.unitCategory.findMany({
      where: {
        tenantId,
        buildingId,
      },
      orderBy: { minM2: 'asc' },
    });

    return categories;
  }

  /**
   * Get a specific category
   */
  async getCategory(
    tenantId: string,
    buildingId: string,
    categoryId: string,
    userRoles: string[],
  ): Promise<UnitCategoryDto> {
    if (!this.validators.canReadCharges(userRoles)) {
      this.validators.throwForbidden('unit category', 'read');
    }

    await this.validators.validateBuildingBelongsToTenant(tenantId, buildingId);

    const category = await this.prisma.unitCategory.findFirst({
      where: {
        id: categoryId,
        tenantId,
        buildingId,
      },
    });

    if (!category) {
      throw new NotFoundException('Unit category not found');
    }

    return category;
  }

  /**
   * Create a new unit category
   * Validates that minM2 and maxM2 don't overlap with existing categories
   */
  async createCategory(
    tenantId: string,
    buildingId: string,
    userRoles: string[],
    userId: string,
    dto: CreateUnitCategoryDto,
  ): Promise<UnitCategoryDto> {
    // Permission: TENANT_ADMIN+ only
    if (!this.validators.canWriteCharges(userRoles)) {
      this.validators.throwForbidden('unit categories', 'create');
    }

    // Validate building
    await this.validators.validateBuildingBelongsToTenant(tenantId, buildingId);

    // Validation: coefficient > 0
    if (dto.coefficient <= 0) {
      throw new BadRequestException('Coefficient must be > 0');
    }

    // Validation: minM2 >= 0
    if (dto.minM2 < 0) {
      throw new BadRequestException('minM2 must be >= 0');
    }

    // Validation: if maxM2 is defined, maxM2 > minM2
    if (dto.maxM2 !== undefined && dto.maxM2 !== null && dto.maxM2 <= dto.minM2) {
      throw new BadRequestException('maxM2 must be > minM2 (if defined)');
    }

    // Validation: unique name per building
    const existing = await this.prisma.unitCategory.findFirst({
      where: {
        tenantId,
        buildingId,
        name: dto.name,
      },
    });

    if (existing) {
      throw new ConflictException(`Category name "${dto.name}" already exists for this building`);
    }

    // Validation: check for overlapping ranges
    await this.validateNoOverlap(tenantId, buildingId, dto.minM2, dto.maxM2);

    // Create category
    const category = await this.prisma.unitCategory.create({
      data: {
        tenantId,
        buildingId,
        name: dto.name,
        minM2: dto.minM2,
        maxM2: dto.maxM2 ?? null,
        coefficient: dto.coefficient,
        active: true,
      },
    });

    // Audit: UNIT_CATEGORY_CREATE
    void this.auditService.createLog({
      tenantId,
      action: AuditAction.UNIT_CATEGORY_CREATE,
      entityType: 'UnitCategory',
      entityId: category.id,
      actorUserId: userId,
      metadata: {
        name: category.name,
        minM2: category.minM2,
        maxM2: category.maxM2,
        coefficient: category.coefficient,
      },
    });

    return category;
  }

  /**
   * Update a category
   * Validates range changes don't create overlaps
   */
  async updateCategory(
    tenantId: string,
    buildingId: string,
    categoryId: string,
    userRoles: string[],
    userId: string,
    dto: UpdateUnitCategoryDto,
  ): Promise<UnitCategoryDto> {
    if (!this.validators.canWriteCharges(userRoles)) {
      this.validators.throwForbidden('unit categories', 'update');
    }

    await this.validators.validateBuildingBelongsToTenant(tenantId, buildingId);

    const existing = await this.prisma.unitCategory.findFirst({
      where: {
        id: categoryId,
        tenantId,
        buildingId,
      },
    });

    if (!existing) {
      throw new NotFoundException('Unit category not found');
    }

    // Validation: if name changes, check uniqueness
    if (dto.name && dto.name !== existing.name) {
      const duplicate = await this.prisma.unitCategory.findFirst({
        where: {
          tenantId,
          buildingId,
          name: dto.name,
        },
      });
      if (duplicate) {
        throw new ConflictException(`Category name "${dto.name}" already exists`);
      }
    }

    // Validation: coefficient > 0
    if (dto.coefficient !== undefined && dto.coefficient <= 0) {
      throw new BadRequestException('Coefficient must be > 0');
    }

    // Validation: range consistency
    const minM2 = dto.minM2 ?? existing.minM2;
    const maxM2 = dto.maxM2 ?? existing.maxM2;

    if (minM2 < 0) {
      throw new BadRequestException('minM2 must be >= 0');
    }

    if (maxM2 !== null && maxM2 !== undefined && maxM2 <= minM2) {
      throw new BadRequestException('maxM2 must be > minM2 (if defined)');
    }

    // Validation: check for overlaps (exclude current category)
    if (dto.minM2 !== undefined || dto.maxM2 !== undefined) {
      await this.validateNoOverlap(tenantId, buildingId, minM2, maxM2, categoryId);
    }

    // Update
    const updated = await this.prisma.unitCategory.update({
      where: { id: categoryId },
      data: {
        name: dto.name,
        minM2,
        maxM2: maxM2 ?? null,
        coefficient: dto.coefficient,
        active: dto.active,
      },
    });

    // Audit: UNIT_CATEGORY_UPDATE
    void this.auditService.createLog({
      tenantId,
      action: AuditAction.UNIT_CATEGORY_UPDATE,
      entityType: 'UnitCategory',
      entityId: categoryId,
      actorUserId: userId,
      metadata: {
        changes: dto,
      },
    });

    return updated;
  }

  /**
   * Soft-delete: disable a category (active = false)
   * Don't allow hard delete if category has associated charges with snapshots
   */
  async deleteCategory(
    tenantId: string,
    buildingId: string,
    categoryId: string,
    userRoles: string[],
    userId: string,
  ): Promise<void> {
    if (!this.validators.canWriteCharges(userRoles)) {
      this.validators.throwForbidden('unit categories', 'delete');
    }

    await this.validators.validateBuildingBelongsToTenant(tenantId, buildingId);

    const category = await this.prisma.unitCategory.findFirst({
      where: {
        id: categoryId,
        tenantId,
        buildingId,
      },
    });

    if (!category) {
      throw new NotFoundException('Unit category not found');
    }

    // Check if category has charges with snapshots
    const snapshotCharges = await this.prisma.charge.findFirst({
      where: {
        tenantId,
        categorySnapshotId: categoryId,
      },
    });

    if (snapshotCharges) {
      // Soft delete: set active = false
      await this.prisma.unitCategory.update({
        where: { id: categoryId },
        data: { active: false },
      });
    } else {
      // No charges: can soft-delete or hard-delete. We soft-delete for consistency
      await this.prisma.unitCategory.update({
        where: { id: categoryId },
        data: { active: false },
      });
    }

    // Audit: UNIT_CATEGORY_DELETE
    void this.auditService.createLog({
      tenantId,
      action: AuditAction.UNIT_CATEGORY_DELETE,
      entityType: 'UnitCategory',
      entityId: categoryId,
      actorUserId: userId,
      metadata: {
        name: category.name,
      },
    });
  }

  /**
   * Auto-assign units to categories based on m2 ranges
   * Returns summary of assigned, unassigned, and already-assigned units
   */
  async autoAssignUnits(
    tenantId: string,
    buildingId: string,
    userRoles: string[],
    userId: string,
    force: boolean = false,
  ): Promise<AutoAssignResultDto> {
    if (!this.validators.canWriteCharges(userRoles)) {
      this.validators.throwForbidden('units', 'update');
    }

    await this.validators.validateBuildingBelongsToTenant(tenantId, buildingId);

    // Get active categories ordered by minM2
    const categories = await this.prisma.unitCategory.findMany({
      where: {
        tenantId,
        buildingId,
        active: true,
      },
      orderBy: { minM2: 'asc' },
    });

    // Get billable units
    const billableUnits = await this.prisma.unit.findMany({
      where: {
        buildingId,
        isBillable: true,
      },
      orderBy: { code: 'asc' },
    });

    const result: AutoAssignResultDto = {
      assigned: 0,
      unassigned: [],
      noM2: [],
      alreadyAssigned: 0,
    };

    // Process each unit
    const updates: Prisma.UnitUpdateArgs[] = [];

    for (const unit of billableUnits) {
      // If no m2, report and skip
      if (unit.m2 === null) {
        result.noM2.push({
          id: unit.id,
          code: unit.code,
          label: unit.label,
        });
        continue;
      }

      // If already assigned and not force, skip
      if (unit.unitCategoryId && !force) {
        result.alreadyAssigned++;
        continue;
      }

      // Find matching category
      let matchedCategory = null;
      for (const cat of categories) {
        const isMatch =
          unit.m2 >= cat.minM2 &&
          (cat.maxM2 === null || unit.m2 <= cat.maxM2);
        if (isMatch) {
          matchedCategory = cat;
          break;
        }
      }

      if (matchedCategory) {
        updates.push({
          where: { id: unit.id },
          data: { unitCategoryId: matchedCategory.id },
        });
        result.assigned++;
      } else {
        result.unassigned.push({
          id: unit.id,
          code: unit.code,
          label: unit.label,
          m2: unit.m2,
        });
      }
    }

    // Apply updates in transaction
    if (updates.length > 0) {
      await this.prisma.$transaction(
        updates.map((update) =>
          this.prisma.unit.update(update as Prisma.UnitUpdateArgs),
        ),
      );
    }

    // Audit: UNIT_CATEGORY_AUTO_ASSIGN
    void this.auditService.createLog({
      tenantId,
      action: AuditAction.UNIT_CATEGORY_AUTO_ASSIGN,
      entityType: 'Building',
      entityId: buildingId,
      actorUserId: userId,
      metadata: result,
    });

    return result;
  }

  /**
   * Preview auto-assign without saving
   */
  async previewAutoAssign(
    tenantId: string,
    buildingId: string,
    userRoles: string[],
    force: boolean = false,
  ): Promise<AutoAssignResultDto> {
    if (!this.validators.canReadCharges(userRoles)) {
      this.validators.throwForbidden('units', 'read');
    }

    await this.validators.validateBuildingBelongsToTenant(tenantId, buildingId);

    const categories = await this.prisma.unitCategory.findMany({
      where: {
        tenantId,
        buildingId,
        active: true,
      },
      orderBy: { minM2: 'asc' },
    });

    const billableUnits = await this.prisma.unit.findMany({
      where: {
        buildingId,
        isBillable: true,
      },
      orderBy: { code: 'asc' },
    });

    const result: AutoAssignResultDto = {
      assigned: 0,
      unassigned: [],
      noM2: [],
      alreadyAssigned: 0,
    };

    for (const unit of billableUnits) {
      if (unit.m2 === null) {
        result.noM2.push({
          id: unit.id,
          code: unit.code,
          label: unit.label,
        });
        continue;
      }

      if (unit.unitCategoryId && !force) {
        result.alreadyAssigned++;
        continue;
      }

      let matchedCategory = null;
      for (const cat of categories) {
        const isMatch =
          unit.m2 >= cat.minM2 &&
          (cat.maxM2 === null || unit.m2 <= cat.maxM2);
        if (isMatch) {
          matchedCategory = cat;
          break;
        }
      }

      if (matchedCategory) {
        result.assigned++;
      } else {
        result.unassigned.push({
          id: unit.id,
          code: unit.code,
          label: unit.label,
          m2: unit.m2,
        });
      }
    }

    return result;
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Validate that a new range doesn't overlap with existing active categories
   */
  private async validateNoOverlap(
    tenantId: string,
    buildingId: string,
    minM2: number,
    maxM2: number | null | undefined,
    excludeId?: string,
  ): Promise<void> {
    const existingCategories = await this.prisma.unitCategory.findMany({
      where: {
        tenantId,
        buildingId,
        active: true,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });

    const newMax = maxM2 === null || maxM2 === undefined ? Infinity : maxM2;

    for (const existing of existingCategories) {
      const existMax = existing.maxM2 === null ? Infinity : existing.maxM2;

      // Overlap check: newMin <= existMax && newMax >= existMin
      const isOverlap = minM2 <= existMax && newMax >= existing.minM2;

      if (isOverlap) {
        throw new ConflictException(
          `Range overlaps with existing category "${existing.name}" (${existing.minM2} - ${existing.maxM2 === null ? '∞' : existing.maxM2} m²)`,
        );
      }
    }
  }
}
