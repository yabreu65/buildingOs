import { Injectable, Logger, BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, RecurringExpenseAllocationMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MovementAllocationService } from './movement-allocation.service';
import {
  CreateRecurringExpenseDto,
  UpdateRecurringExpenseDto,
  RecurringExpenseDto,
} from './recurring-expense.dto';

/**
 * Contexto de scope esperado para operaciones de actualización.
 * BUILDING: buildingId de la ruta (nunca null).
 * TENANT_SHARED: buildingId null obligatoriamente.
 */
export interface RecurringExpenseUpdateScope {
  scopeType: 'BUILDING' | 'TENANT_SHARED';
  buildingId: string | null;
}

/**
 * RecurringExpenseService — canonical, transactional recurring expense templates.
 *
 * BUILDING scope: single building, buildingId from route, no allocations.
 * TENANT_SHARED scope: multi-building, allocationMode required.
 *   - MANUAL: percentage templates stored in RecurringExpenseAllocation.
 *   - EQUAL_SHARE / BUILDING_TOTAL_M2: computed dynamically at execution time.
 */
@Injectable()
export class RecurringExpenseService {
  private readonly logger = new Logger(RecurringExpenseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly movementAllocationService: MovementAllocationService,
  ) {}

  /**
   * Create a new recurring expense template.
   * BUILDING: requires buildingId from route param, no allocations.
   * TENANT_SHARED MANUAL: requires allocations (percentage only), atomic create.
   * TENANT_SHARED EQUAL_SHARE / BUILDING_TOTAL_M2: no allocations stored.
   */
  async createRecurringExpense(
    tenantId: string,
    createDto: CreateRecurringExpenseDto,
    buildingId?: string,
  ): Promise<RecurringExpenseDto> {
    // --- Scope resolution from the ORIGINAL payload (before resolving scope) ---
    const isBuildingRoute = !!buildingId;

    // Building route: scopeType must be omitted or BUILDING
    if (isBuildingRoute && createDto.scopeType === 'TENANT_SHARED') {
      throw new BadRequestException(
        'Los endpoints /buildings/:buildingId solo permiten scopeType BUILDING',
      );
    }
    // Tenant route: scopeType must be omitted or TENANT_SHARED
    if (!isBuildingRoute && createDto.scopeType === 'BUILDING') {
      throw new BadRequestException(
        'scopeType BUILDING requiere la ruta /buildings/:buildingId',
      );
    }

    const scopeType = isBuildingRoute
      ? 'BUILDING'
      : (createDto.scopeType ?? 'TENANT_SHARED');

    // --- BUILDING invariants ---
    if (scopeType === 'BUILDING') {
      await this.validateBuildingBelongsToTenant(tenantId, buildingId!);

      // Reject allocations and allocationMode on BUILDING scope
      if (createDto.allocations && createDto.allocations.length > 0) {
        throw new BadRequestException(
          'No se pueden enviar allocations para scope BUILDING',
        );
      }
      if (createDto.allocationMode) {
        throw new BadRequestException(
          'No se puede enviar allocationMode para scope BUILDING',
        );
      }
    }

    // --- TENANT_SHARED invariants ---
    let allocationMode: RecurringExpenseAllocationMode | null = null;
    if (scopeType === 'TENANT_SHARED') {
      if (!createDto.allocationMode) {
        throw new BadRequestException('allocationMode es requerido para scope TENANT_SHARED');
      }
      allocationMode = createDto.allocationMode;

      if (allocationMode === RecurringExpenseAllocationMode.MANUAL) {
        if (!createDto.allocations || createDto.allocations.length === 0) {
          throw new BadRequestException(
            'allocations es requerido para allocationMode MANUAL',
          );
        }
        // Canonical allocation validation: tenant ownership, duplicates,
        // percentage range and sum=100% (percentage mode, no amountMinor)
        await this.movementAllocationService.validateAllocations(
          tenantId,
          createDto.allocations,
          createDto.amount,
          createDto.currency,
        );
      } else {
        // EQUAL_SHARE / BUILDING_TOTAL_M2: reject allocations if provided
        if (createDto.allocations && createDto.allocations.length > 0) {
          throw new BadRequestException(
            `allocationMode ${allocationMode} no acepta allocations manuales. Use EQUAL_SHARE o BUILDING_TOTAL_M2 sin allocations.`,
          );
        }
      }
    }

    // --- Category scope validation ---
    const category = await this.prisma.expenseLedgerCategory.findFirst({
      where: { id: createDto.categoryId, tenantId, isActive: true },
    });
    if (!category) {
      throw new NotFoundException(`Rubro de gasto no encontrado: ${createDto.categoryId}`);
    }

    if (scopeType === 'BUILDING' && category.catalogScope !== 'BUILDING') {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'CATEGORY_SCOPE_MISMATCH',
        message: `El rubro "${category.name}" es de scope CONDOMINIUM_COMMON y no puede usarse para gastos recurrentes BUILDING.`,
      });
    }
    if (scopeType === 'TENANT_SHARED' && category.catalogScope !== 'CONDOMINIUM_COMMON') {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'CATEGORY_SCOPE_MISMATCH',
        message: `El rubro "${category.name}" es de scope BUILDING y no puede usarse para gastos recurrentes TENANT_SHARED.`,
      });
    }

    const nextRunDate = this.calculateNextRunDate(new Date(), createDto.frequency);

    if (scopeType === 'TENANT_SHARED' && allocationMode === RecurringExpenseAllocationMode.MANUAL) {
      // Atomic: create RecurringExpense + RecurringExpenseAllocation[] in one transaction
      const result = await this.prisma.$transaction(async (tx) => {
        const recurring = await tx.recurringExpense.create({
          data: {
            tenantId,
            buildingId: null,
            scopeType,
            allocationMode,
            categoryId: createDto.categoryId,
            amount: createDto.amount,
            currency: createDto.currency,
            concept: createDto.concept,
            frequency: createDto.frequency,
            nextRunDate,
            isActive: true,
          },
        });

        await tx.recurringExpenseAllocation.createMany({
          data: createDto.allocations!.map((alloc) => ({
            tenantId,
            recurringExpenseId: recurring.id,
            buildingId: alloc.buildingId,
            percentage: alloc.percentage,
          })),
        });

        return recurring;
      });

      void this.auditService.createLog({
        tenantId,
        action: 'EXPENSE_CREATE',
        entityType: 'RecurringExpense',
        entityId: result.id,
        metadata: {
          scopeType,
          ...(allocationMode ? { allocationMode } : {}),
          frequency: createDto.frequency,
          amount: createDto.amount,
          concept: createDto.concept,
          nextRunDate: nextRunDate.toISOString(),
          allocationCount: createDto.allocations!.length,
        },
      });

      return result as RecurringExpenseDto;
    }

    // BUILDING or TENANT_SHARED with EQUAL_SHARE/BUILDING_TOTAL_M2
    const recurring = await this.prisma.recurringExpense.create({
      data: {
        tenantId,
        buildingId: scopeType === 'BUILDING' ? buildingId! : null,
        scopeType,
        allocationMode,
        categoryId: createDto.categoryId,
        amount: createDto.amount,
        currency: createDto.currency,
        concept: createDto.concept,
        frequency: createDto.frequency,
        nextRunDate,
        isActive: true,
      },
    });

    void this.auditService.createLog({
      tenantId,
      action: 'EXPENSE_CREATE',
      entityType: 'RecurringExpense',
      entityId: recurring.id,
      metadata: {
        scopeType,
        ...(allocationMode ? { allocationMode } : {}),
        frequency: createDto.frequency,
        amount: createDto.amount,
        concept: createDto.concept,
        nextRunDate: nextRunDate.toISOString(),
      },
    });

    return recurring as RecurringExpenseDto;
  }

  /**
   * List recurring expenses for a building or tenant.
   */
  async listRecurringExpenses(
    tenantId: string,
    buildingId: string | undefined,
    includeInactive: boolean = false,
    scopeType?: 'BUILDING' | 'TENANT_SHARED',
  ): Promise<RecurringExpenseDto[]> {
    const where: Record<string, unknown> = {
      tenantId,
      ...(includeInactive ? {} : { isActive: true }),
    };

    if (scopeType) {
      where.scopeType = scopeType;
    }

    if (buildingId) {
      where.buildingId = buildingId;
    } else {
      where.buildingId = null;
    }

    return this.prisma.recurringExpense.findMany({
      where,
      orderBy: { nextRunDate: 'asc' },
    }) as Promise<RecurringExpenseDto[]>;
  }

  /**
   * Update a recurring expense template.
   * Allocation replacement for TENANT_SHARED MANUAL is transactional.
   * Changing allocationMode to EQUAL_SHARE/BUILDING_TOTAL_M2 removes templates.
   * Changing to MANUAL requires new allocations.
   * BUILDING scope rejects allocationMode and allocations.
   * All mutations are tenant-scoped (updateMany with id+tenantId).
   * The initial lookup enforces the expected scope: a rule outside the
   * requested scope (wrong building or wrong scopeType) is a 404.
   */
  async updateRecurringExpense(
    tenantId: string,
    recurringId: string,
    updateDto: UpdateRecurringExpenseDto,
    expectedScope: RecurringExpenseUpdateScope,
  ): Promise<RecurringExpenseDto> {
    const existing = await this.prisma.recurringExpense.findFirst({
      where: {
        id: recurringId,
        tenantId,
        scopeType: expectedScope.scopeType,
        buildingId: expectedScope.buildingId,
      },
      include: { allocations: true },
    });

    if (!existing) {
      throw new NotFoundException(`RecurringExpense not found: ${recurringId}`);
    }

    // BUILDING scope: reject allocationMode and allocations
    if (existing.scopeType === 'BUILDING') {
      if (updateDto.allocationMode) {
        throw new BadRequestException(
          'No se puede cambiar allocationMode en scope BUILDING',
        );
      }
      if (updateDto.allocations && updateDto.allocations.length > 0) {
        throw new BadRequestException(
          'No se pueden enviar allocations en scope BUILDING',
        );
      }
    }

    // Determine effective allocationMode after update
    const effectiveMode = updateDto.allocationMode ?? existing.allocationMode;
    // Effective amount/currency after the update, for allocation validation
    const effectiveAmount = updateDto.amount ?? existing.amount;
    const effectiveCurrency = existing.currency;

    if (existing.scopeType === 'TENANT_SHARED') {
      if (effectiveMode === RecurringExpenseAllocationMode.MANUAL) {
        if (updateDto.allocations) {
          // Validate fully BEFORE replacing templates
          await this.movementAllocationService.validateAllocations(
            tenantId,
            updateDto.allocations,
            effectiveAmount,
            effectiveCurrency,
          );

          // Replacement: delete+create atomically, tenant-scoped
          return await this.prisma.$transaction(async (tx) => {
            await tx.recurringExpenseAllocation.deleteMany({
              where: { recurringExpenseId: recurringId, tenantId },
            });

            await tx.recurringExpenseAllocation.createMany({
              data: updateDto.allocations!.map((alloc) => ({
                tenantId,
                recurringExpenseId: recurringId,
                buildingId: alloc.buildingId,
                percentage: alloc.percentage,
              })),
            });

            const updateResult = await tx.recurringExpense.updateMany({
              where: { id: recurringId, tenantId },
              data: {
                ...(updateDto.isActive !== undefined && { isActive: updateDto.isActive }),
                ...(updateDto.amount !== undefined && { amount: updateDto.amount }),
                ...(updateDto.concept !== undefined && { concept: updateDto.concept }),
                ...(updateDto.allocationMode !== undefined && { allocationMode: updateDto.allocationMode }),
              },
            });
            if (updateResult.count !== 1) {
              throw new NotFoundException(`RecurringExpense not found: ${recurringId}`);
            }

            const updated = await tx.recurringExpense.findFirst({
              where: { id: recurringId, tenantId },
              include: { allocations: true },
            });
            if (!updated) {
              throw new NotFoundException(`RecurringExpense not found: ${recurringId}`);
            }

            return updated as unknown as RecurringExpenseDto;
          });
        }

        // No new allocations: only valid when the rule already is MANUAL
        // with persisted templates; transitioning from a dynamic mode to
        // MANUAL without new allocations would violate the model invariant.
        if (
          existing.allocationMode !== RecurringExpenseAllocationMode.MANUAL ||
          existing.allocations.length === 0
        ) {
          throw new BadRequestException(
            'Para allocationMode MANUAL se requieren allocations',
          );
        }

        // No allocations change, just update fields (tenant-scoped)
        const updated = await this.prisma.recurringExpense.updateMany({
          where: { id: recurringId, tenantId },
          data: {
            ...(updateDto.isActive !== undefined && { isActive: updateDto.isActive }),
            ...(updateDto.amount !== undefined && { amount: updateDto.amount }),
            ...(updateDto.concept !== undefined && { concept: updateDto.concept }),
            ...(updateDto.allocationMode !== undefined && { allocationMode: updateDto.allocationMode }),
          },
        });
        if (updated.count !== 1) {
          throw new NotFoundException(`RecurringExpense not found: ${recurringId}`);
        }

        const refreshed = await this.prisma.recurringExpense.findFirst({
          where: { id: recurringId, tenantId },
          include: { allocations: true },
        });
        if (!refreshed) {
          throw new NotFoundException(`RecurringExpense not found: ${recurringId}`);
        }

        return refreshed as unknown as RecurringExpenseDto;
      }

      // Switching to EQUAL_SHARE or BUILDING_TOTAL_M2
      if (updateDto.allocationMode && updateDto.allocationMode !== RecurringExpenseAllocationMode.MANUAL) {
        // Reject allocations if provided
        if (updateDto.allocations && updateDto.allocations.length > 0) {
          throw new BadRequestException(
            `allocationMode ${updateDto.allocationMode} no acepta allocations manuales`,
          );
        }

        return await this.prisma.$transaction(async (tx) => {
          // Delete template allocations (tenant-scoped)
          await tx.recurringExpenseAllocation.deleteMany({
            where: { recurringExpenseId: recurringId, tenantId },
          });

          const updateResult = await tx.recurringExpense.updateMany({
            where: { id: recurringId, tenantId },
            data: {
              ...(updateDto.isActive !== undefined && { isActive: updateDto.isActive }),
              ...(updateDto.amount !== undefined && { amount: updateDto.amount }),
              ...(updateDto.concept !== undefined && { concept: updateDto.concept }),
              allocationMode: updateDto.allocationMode,
            },
          });
          if (updateResult.count !== 1) {
            throw new NotFoundException(`RecurringExpense not found: ${recurringId}`);
          }

          const updated = await tx.recurringExpense.findFirst({
            where: { id: recurringId, tenantId },
            include: { allocations: true },
          });
          if (!updated) {
            throw new NotFoundException(`RecurringExpense not found: ${recurringId}`);
          }

          return updated as unknown as RecurringExpenseDto;
        });
      }
    }

    // Default: just update fields (tenant-scoped)
    const updated = await this.prisma.recurringExpense.updateMany({
      where: { id: recurringId, tenantId },
      data: {
        ...(updateDto.isActive !== undefined && { isActive: updateDto.isActive }),
        ...(updateDto.amount !== undefined && { amount: updateDto.amount }),
        ...(updateDto.concept !== undefined && { concept: updateDto.concept }),
        ...(updateDto.allocationMode !== undefined && { allocationMode: updateDto.allocationMode }),
      },
    });
    if (updated.count !== 1) {
      throw new NotFoundException(`RecurringExpense not found: ${recurringId}`);
    }

    const refreshed = await this.prisma.recurringExpense.findFirst({
      where: { id: recurringId, tenantId },
      include: { allocations: true },
    });
    if (!refreshed) {
      throw new NotFoundException(`RecurringExpense not found: ${recurringId}`);
    }

    return refreshed as unknown as RecurringExpenseDto;
  }

  /**
   * Process all due recurring expenses.
   * Each rule is executed inside a single transaction:
   *   create Expense + create MovementAllocation[] + update nextRunDate
   * If any step fails, the entire rule rolls back.
   * Audit is fired AFTER the transaction commits.
   */
  async processRecurringExpenses(): Promise<{ createdCount: number }> {
    const now = new Date();

    const due = await this.prisma.recurringExpense.findMany({
      where: {
        isActive: true,
        nextRunDate: { lte: now },
      },
      include: {
        allocations: { select: { buildingId: true, percentage: true } },
      },
    });

    let createdCount = 0;

    for (const recurring of due) {
      try {
        await this.processOneRecurringExpense(recurring, now);
        createdCount++;
      } catch (error) {
        this.logger.error(
          `Failed to process recurring expense ${recurring.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return { createdCount };
  }

  /**
   * Process a single recurring expense rule.
   * The transaction only performs the atomic mutations and returns minimal data;
   * the audit log is fired AFTER the transaction resolves (post-commit).
   */
  private async processOneRecurringExpense(
    recurring: {
      id: string;
      tenantId: string;
      buildingId: string | null;
      scopeType: string;
      allocationMode: RecurringExpenseAllocationMode | null;
      categoryId: string;
      amount: number;
      currency: string;
      concept: string;
      frequency: string;
      allocations: Array<{ buildingId: string; percentage: number }>;
    },
    now: Date,
  ): Promise<void> {
    const period = this.getCurrentPeriod();
    const nextRun = this.calculateNextRunDate(now, recurring.frequency);

    if (recurring.scopeType === 'BUILDING') {
      if (!recurring.buildingId) {
        throw new Error(`RecurringExpense ${recurring.id} has BUILDING scope but no buildingId`);
      }

      const expenseId = await this.prisma.$transaction(async (tx) => {
        const expense = await tx.expense.create({
          data: {
            tenantId: recurring.tenantId,
            buildingId: recurring.buildingId!,
            period,
            categoryId: recurring.categoryId,
            description: `[Recurrente] ${recurring.concept}`,
            amountMinor: recurring.amount,
            currencyCode: recurring.currency,
            invoiceDate: now,
            status: 'DRAFT',
            scopeType: 'BUILDING',
            createdByMembershipId: 'system-recurring-cronjob',
            postedAt: now,
          },
        });

        const nextRunResult = await tx.recurringExpense.updateMany({
          where: { id: recurring.id, tenantId: recurring.tenantId },
          data: { nextRunDate: nextRun },
        });
        if (nextRunResult.count !== 1) {
          throw new Error(
            `RecurringExpense ${recurring.id} no encontrado para actualizar nextRunDate`,
          );
        }

        return expense.id;
      });

      // Post-commit audit
      void this.auditService.createLog({
        tenantId: recurring.tenantId,
        action: 'EXPENSE_CREATE',
        entityType: 'Expense',
        entityId: expenseId,
        metadata: {
          source: 'RECURRING_CRONJOB',
          recurringId: recurring.id,
          scopeType: recurring.scopeType,
          frequency: recurring.frequency,
          nextRunDate: nextRun.toISOString(),
        },
      });
      return;
    }

    // --- TENANT_SHARED ---
    let percentageAllocations: Array<{ buildingId: string; percentage: number }>;

    if (recurring.allocationMode === RecurringExpenseAllocationMode.MANUAL) {
      if (recurring.allocations.length === 0) {
        throw new Error(
          `RecurringExpense ${recurring.id} is MANUAL but has no allocations`,
        );
      }
      percentageAllocations = recurring.allocations;
    } else if (
      recurring.allocationMode === RecurringExpenseAllocationMode.EQUAL_SHARE ||
      recurring.allocationMode === RecurringExpenseAllocationMode.BUILDING_TOTAL_M2
    ) {
      const suggestions = await this.movementAllocationService.suggestAllocationsByMode(
        recurring.tenantId,
        recurring.allocationMode,
      );
      if (suggestions.length === 0) {
        throw new Error(
          `RecurringExpense ${recurring.id} mode ${recurring.allocationMode} produced zero buildings`,
        );
      }
      percentageAllocations = suggestions.map((s) => ({
        buildingId: s.buildingId,
        percentage: s.percentage,
      }));
    } else {
      throw new Error(
        `RecurringExpense ${recurring.id} has invalid allocationMode: ${recurring.allocationMode}`,
      );
    }

    // Validate resolved allocations (manual or dynamic) before creating anything.
    // Protects against deleted/foreign buildings, duplicates, wrong sum,
    // and invalid dynamic distributions.
    await this.movementAllocationService.validateAllocations(
      recurring.tenantId,
      percentageAllocations,
      recurring.amount,
      recurring.currency,
    );

    // Atomic: create Expense + MovementAllocations (canonical, largest remainder)
    // + update nextRunDate. No audit inside the transaction.
    const expenseId = await this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          tenantId: recurring.tenantId,
          buildingId: null,
          period,
          categoryId: recurring.categoryId,
          description: `[Recurrente] ${recurring.concept}`,
          amountMinor: recurring.amount,
          currencyCode: recurring.currency,
          invoiceDate: now,
          status: 'DRAFT',
          scopeType: 'TENANT_SHARED',
          createdByMembershipId: 'system-recurring-cronjob',
          postedAt: now,
        },
      });

      await this.movementAllocationService.createForExpenseInTx(
        tx,
        recurring.tenantId,
        expense.id,
        recurring.amount,
        recurring.currency,
        percentageAllocations,
      );

      const nextRunResult = await tx.recurringExpense.updateMany({
        where: { id: recurring.id, tenantId: recurring.tenantId },
        data: { nextRunDate: nextRun },
      });
      if (nextRunResult.count !== 1) {
        throw new Error(
          `RecurringExpense ${recurring.id} no encontrado para actualizar nextRunDate`,
        );
      }

      return expense.id;
    });

    // Post-commit audit
    void this.auditService.createLog({
      tenantId: recurring.tenantId,
      action: 'EXPENSE_CREATE',
      entityType: 'Expense',
      entityId: expenseId,
      metadata: {
        source: 'RECURRING_CRONJOB',
        recurringId: recurring.id,
        scopeType: recurring.scopeType,
        allocationMode: recurring.allocationMode,
        frequency: recurring.frequency,
        nextRunDate: nextRun.toISOString(),
      },
    });
  }

  // --- Private helpers ---

  private calculateNextRunDate(from: Date, frequency: string): Date {
    const next = new Date(from);
    switch (frequency) {
      case 'MONTHLY':
        next.setMonth(next.getMonth() + 1);
        break;
      case 'QUARTERLY':
        next.setMonth(next.getMonth() + 3);
        break;
      case 'YEARLY':
        next.setFullYear(next.getFullYear() + 1);
        break;
    }
    return next;
  }

  private getCurrentPeriod(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  private async validateBuildingBelongsToTenant(tenantId: string, buildingId: string): Promise<void> {
    const building = await this.prisma.building.findFirst({
      where: { id: buildingId, tenantId },
    });
    if (!building) {
      throw new NotFoundException(`Building not found: ${buildingId}`);
    }
  }
}
