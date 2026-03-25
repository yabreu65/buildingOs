import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import {
  Prisma,
  ExpensePeriod,
  ExpensePeriodStatus,
  ChargeStatus,
  AuditAction,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import {
  CreateExpensePeriodDto,
  UpdateExpensePeriodDto,
  ExpensePeriodDto,
  ExpensePeriodDetailDto,
  GenerateResultDto,
  BlockedGenerationErrorDto,
} from './expense-periods.dto';

@Injectable()
export class ExpensePeriodsService {
  constructor(
    private prisma: PrismaService,
    private validators: FinanzasValidators,
    private auditService: AuditService,
  ) {}

  /**
   * Convert Prisma ExpensePeriod to DTO (handles BigInt serialization)
   */
  private toDto(period: ExpensePeriod): ExpensePeriodDto {
    return {
      ...period,
      totalToAllocate: period.totalToAllocate.toString(),
    };
  }

  /**
   * List expense periods for a building
   */
  async listPeriods(
    tenantId: string,
    buildingId: string,
    userRoles: string[],
    year?: number,
    month?: number,
    status?: ExpensePeriodStatus,
  ): Promise<ExpensePeriodDto[]> {
    if (!this.validators.canReadCharges(userRoles)) {
      this.validators.throwForbidden('expense periods', 'read');
    }

    await this.validators.validateBuildingBelongsToTenant(tenantId, buildingId);

    const where: Prisma.ExpensePeriodWhereInput = {
      tenantId,
      buildingId,
    };

    if (year !== undefined) where.year = year;
    if (month !== undefined) where.month = month;
    if (status !== undefined) where.status = status;

    const periods = await this.prisma.expensePeriod.findMany({
      where,
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    return periods.map((p) => this.toDto(p));
  }

  /**
   * Get a specific expense period with charges
   */
  async getPeriod(
    tenantId: string,
    buildingId: string,
    periodId: string,
    userRoles: string[],
  ): Promise<ExpensePeriodDetailDto> {
    if (!this.validators.canReadCharges(userRoles)) {
      this.validators.throwForbidden('expense period', 'read');
    }

    await this.validators.validateBuildingBelongsToTenant(tenantId, buildingId);

    const period = await this.prisma.expensePeriod.findFirst({
      where: {
        id: periodId,
        tenantId,
        buildingId,
      },
      include: {
        charges: {
          include: {
            unit: {
              select: {
                id: true,
                code: true,
                label: true,
              },
            },
          },
          where: {
            canceledAt: null,
          },
          orderBy: { unit: { code: 'asc' } },
        },
      },
    });

    if (!period) {
      throw new NotFoundException('Expense period not found');
    }

    return {
      ...period,
      totalToAllocate: period.totalToAllocate.toString(),
      charges: period.charges.map((c) => ({
        id: c.id,
        unitId: c.unitId,
        unitCode: c.unit.code,
        unitLabel: c.unit.label,
        amount: c.amount,
        status: c.status,
        coefficientSnapshot: c.coefficientSnapshot,
        categorySnapshotId: c.categorySnapshotId,
      })),
    } as ExpensePeriodDetailDto;
  }

  /**
   * Create a new expense period (status = DRAFT)
   */
  async createPeriod(
    tenantId: string,
    buildingId: string,
    userRoles: string[],
    userId: string,
    dto: CreateExpensePeriodDto,
  ): Promise<ExpensePeriodDto> {
    if (!this.validators.canWriteCharges(userRoles)) {
      this.validators.throwForbidden('expense periods', 'create');
    }

    await this.validators.validateBuildingBelongsToTenant(tenantId, buildingId);

    // Validation: totalToAllocate > 0
    if (dto.totalToAllocate <= 0) {
      throw new BadRequestException('totalToAllocate must be > 0');
    }

    // Validation: unique year + month per building
    const existing = await this.prisma.expensePeriod.findFirst({
      where: {
        tenantId,
        buildingId,
        year: dto.year,
        month: dto.month,
      },
    });

    if (existing) {
      throw new ConflictException(
        `Expense period for ${dto.year}-${String(dto.month).padStart(2, '0')} already exists`,
      );
    }

    // Create in DRAFT status
    const period = await this.prisma.expensePeriod.create({
      data: {
        tenantId,
        buildingId,
        year: dto.year,
        month: dto.month,
        totalToAllocate: dto.totalToAllocate,
        currency: dto.currency || 'ARS',
        dueDate: new Date(dto.dueDate),
        concept: dto.concept,
        status: ExpensePeriodStatus.DRAFT,
      },
    });

    // Audit: EXPENSE_PERIOD_CREATE
    void this.auditService.createLog({
      tenantId,
      action: AuditAction.EXPENSE_PERIOD_CREATE,
      entityType: 'ExpensePeriod',
      entityId: period.id,
      actorUserId: userId,
      metadata: {
        year: period.year,
        month: period.month,
        totalToAllocate: period.totalToAllocate.toString(),
        concept: period.concept,
      },
    });

    return this.toDto(period);
  }

  /**
   * Update an expense period (only DRAFT periods can be updated)
   */
  async updatePeriod(
    tenantId: string,
    buildingId: string,
    periodId: string,
    userRoles: string[],
    userId: string,
    dto: UpdateExpensePeriodDto,
  ): Promise<ExpensePeriodDto> {
    if (!this.validators.canWriteCharges(userRoles)) {
      this.validators.throwForbidden('expense periods', 'update');
    }

    await this.validators.validateBuildingBelongsToTenant(tenantId, buildingId);

    const period = await this.prisma.expensePeriod.findFirst({
      where: {
        id: periodId,
        tenantId,
        buildingId,
      },
    });

    if (!period) {
      throw new NotFoundException('Expense period not found');
    }

    // Only DRAFT periods can be edited
    if (period.status !== ExpensePeriodStatus.DRAFT) {
      throw new ForbiddenException(
        `Cannot update a ${period.status} expense period`,
      );
    }

    // Validation: if totalToAllocate changes, must be > 0
    if (
      dto.totalToAllocate !== undefined &&
      dto.totalToAllocate <= 0
    ) {
      throw new BadRequestException('totalToAllocate must be > 0');
    }

    const updated = await this.prisma.expensePeriod.update({
      where: { id: periodId },
      data: {
        totalToAllocate: dto.totalToAllocate,
        currency: dto.currency,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        concept: dto.concept,
      },
    });

    // Audit: EXPENSE_PERIOD_UPDATE (implicit, no dedicated action)
    // Skipped for simplicity

    return this.toDto(updated);
  }

  /**
   * Delete an expense period (only DRAFT periods)
   */
  async deletePeriod(
    tenantId: string,
    buildingId: string,
    periodId: string,
    userRoles: string[],
    userId: string,
  ): Promise<void> {
    if (!this.validators.canWriteCharges(userRoles)) {
      this.validators.throwForbidden('expense periods', 'delete');
    }

    await this.validators.validateBuildingBelongsToTenant(tenantId, buildingId);

    const period = await this.prisma.expensePeriod.findFirst({
      where: {
        id: periodId,
        tenantId,
        buildingId,
      },
    });

    if (!period) {
      throw new NotFoundException('Expense period not found');
    }

    // Only DRAFT periods can be deleted
    if (period.status !== ExpensePeriodStatus.DRAFT) {
      throw new UnprocessableEntityException(
        `Cannot delete a ${period.status} expense period`,
      );
    }

    // Delete charges first, then period
    await this.prisma.charge.deleteMany({
      where: {
        periodId,
      },
    });

    await this.prisma.expensePeriod.delete({
      where: { id: periodId },
    });

    // Audit: EXPENSE_PERIOD_DELETE
    void this.auditService.createLog({
      tenantId,
      action: AuditAction.EXPENSE_PERIOD_DELETE,
      entityType: 'ExpensePeriod',
      entityId: periodId,
      actorUserId: userId,
      metadata: {
        year: period.year,
        month: period.month,
      },
    });
  }

  /**
   * Generate charges from an expense period
   * Algorithm:
   * 1. Validate allocationMode, totalToAllocate, category assignments
   * 2. Calculate coefficient-based allocation with exact cent distribution
   * 3. Create charges with snapshots
   * 4. Set status DRAFT → GENERATED
   */
  async generateCharges(
    tenantId: string,
    buildingId: string,
    periodId: string,
    userRoles: string[],
    userId: string,
  ): Promise<GenerateResultDto> {
    if (!this.validators.canWriteCharges(userRoles)) {
      this.validators.throwForbidden('expense periods', 'generate');
    }

    await this.validators.validateBuildingBelongsToTenant(tenantId, buildingId);

    // 1. Get period and validate
    const period = await this.prisma.expensePeriod.findFirst({
      where: {
        id: periodId,
        tenantId,
        buildingId,
      },
    });

    if (!period) {
      throw new NotFoundException('Expense period not found');
    }

    if (period.status !== ExpensePeriodStatus.DRAFT) {
      throw new ConflictException(
        `Cannot generate charges for a ${period.status} period`,
      );
    }

    // 2. Validate building allocation mode
    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
    });

    if (!building) {
      throw new NotFoundException('Building not found');
    }

    if (
      building.allocationMode !==
      'BY_CATEGORY_RANGE_M2_COEFFICIENT'
    ) {
      throw new BadRequestException(
        'Building is not configured for automatic expense allocation',
      );
    }

    // 3. Convert BigInt to number for calculations
    const totalToAllocateNum = Number(period.totalToAllocate);

    // 3.5. Validate totalToAllocate > 0
    if (totalToAllocateNum === 0) {
      throw new BadRequestException('totalToAllocate must be > 0');
    }

    // 4. Get billable units with categories (active only)
    const billableUnits = await this.prisma.unit.findMany({
      where: {
        buildingId,
        isBillable: true,
      },
      include: {
        unitCategory: true,
      },
      orderBy: { code: 'asc' }, // Deterministic order
    });

    // 5. Check that all billable units have active categories
    const unitsWithoutCategory = billableUnits.filter(
      (u) => !u.unitCategory || !u.unitCategory.active,
    );

    if (unitsWithoutCategory.length > 0) {
      const error: BlockedGenerationErrorDto = {
        message: 'Cannot generate charges: some billable units have no active category',
        reason: 'units_without_category',
        unitsWithoutCategory: unitsWithoutCategory.map((u) => ({
          id: u.id,
          code: u.code,
          label: u.label,
        })),
      };
      throw new UnprocessableEntityException(error);
    }

    // 6. Calculate sum of coefficients
    const sumCoef = billableUnits.reduce((sum, u) => {
      return sum + (u.unitCategory?.coefficient ?? 0);
    }, 0);

    if (sumCoef === 0) {
      throw new BadRequestException(
        'Sum of coefficients is 0, cannot allocate',
      );
    }

    // 7. Calculate exact amounts and distribute remainder
    const amounts: { unitId: string; amountInt: number; fraction: number }[] = [];
    let totalAllocated = 0;

    for (const unit of billableUnits) {
      const coef = unit.unitCategory!.coefficient;
      const amountExact = (coef / sumCoef) * totalToAllocateNum;
      const amountInt = Math.floor(amountExact);
      const fraction = amountExact - amountInt;

      amounts.push({
        unitId: unit.id,
        amountInt,
        fraction,
      });

      totalAllocated += amountInt;
    }

    // 8. Distribute remainder (delta)
    const delta = totalToAllocateNum - totalAllocated;

    // Sort by fraction descending, add 1 to top delta units
    const sorted = amounts.sort((a, b) => b.fraction - a.fraction);
    for (let i = 0; i < delta && i < sorted.length; i++) {
      sorted[i]!.amountInt += 1;
    }

    // 9. Create charges in transaction
    const charges = billableUnits.map((unit) => {
      const amountData = amounts.find((a) => a.unitId === unit.id)!;
      return {
        tenantId,
        buildingId,
        unitId: unit.id,
        period: `${period.year}-${String(period.month).padStart(2, '0')}`,
        type: 'COMMON_EXPENSE',
        concept: period.concept,
        amount: amountData.amountInt,
        currency: period.currency,
        dueDate: period.dueDate,
        status: ChargeStatus.PENDING,
        createdByMembershipId: null,
        periodId: period.id,
        coefficientSnapshot: unit.unitCategory!.coefficient,
        sumCoefSnapshot: sumCoef,
        totalToAllocateSnapshot: Number(period.totalToAllocate),
        categorySnapshotId: unit.unitCategory!.id,
      };
    });

    // Delete any existing charges for this period (re-generation)
    await this.prisma.charge.deleteMany({
      where: {
        periodId,
        status: ChargeStatus.PENDING,
      },
    });

    // Batch create
    await this.prisma.charge.createMany({
      data: charges as Prisma.ChargeCreateManyInput[],
    });

    // Update period status
    await this.prisma.expensePeriod.update({
      where: { id: periodId },
      data: { status: ExpensePeriodStatus.GENERATED },
    });

    // Audit: EXPENSE_PERIOD_GENERATE
    void this.auditService.createLog({
      tenantId,
      action: AuditAction.EXPENSE_PERIOD_GENERATE,
      entityType: 'ExpensePeriod',
      entityId: periodId,
      actorUserId: userId,
      metadata: {
        chargesCount: charges.length,
        totalAllocated: period.totalToAllocate.toString(),
        sumCoef,
      },
    });

    return {
      chargesCount: charges.length,
      totalAllocated: period.totalToAllocate.toString(),
    };
  }

  /**
   * Publish an expense period (GENERATED → PUBLISHED)
   * Once published, residents can see charges
   */
  async publishPeriod(
    tenantId: string,
    buildingId: string,
    periodId: string,
    userRoles: string[],
    userId: string,
  ): Promise<ExpensePeriodDto> {
    if (!this.validators.canWriteCharges(userRoles)) {
      this.validators.throwForbidden('expense periods', 'publish');
    }

    await this.validators.validateBuildingBelongsToTenant(tenantId, buildingId);

    const period = await this.prisma.expensePeriod.findFirst({
      where: {
        id: periodId,
        tenantId,
        buildingId,
      },
    });

    if (!period) {
      throw new NotFoundException('Expense period not found');
    }

    if (period.status !== ExpensePeriodStatus.GENERATED) {
      throw new ConflictException(
        `Can only publish GENERATED periods (current: ${period.status})`,
      );
    }

    const published = await this.prisma.expensePeriod.update({
      where: { id: periodId },
      data: {
        status: ExpensePeriodStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    });

    // Audit: EXPENSE_PERIOD_PUBLISH
    void this.auditService.createLog({
      tenantId,
      action: AuditAction.EXPENSE_PERIOD_PUBLISH,
      entityType: 'ExpensePeriod',
      entityId: periodId,
      actorUserId: userId,
      metadata: {
        year: published.year,
        month: published.month,
      },
    });

    return this.toDto(published);
  }
}
