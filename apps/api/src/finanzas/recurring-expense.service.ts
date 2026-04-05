import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RecurringExpense, AuditAction } from '@prisma/client';
import {
  CreateRecurringExpenseDto,
  UpdateRecurringExpenseDto,
  RecurringExpenseDto,
} from './recurring-expense.dto';

/**
 * [PHASE 4 HARD #14] RecurringExpenseService
 * Manages recurring expense templates that auto-generate DRAFT expenses
 * - Create/update/delete recurring expense rules
 * - Daily cronjob processes due rules and creates DRAFT expenses
 */
@Injectable()
export class RecurringExpenseService {
  private readonly logger = new Logger(RecurringExpenseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Create a new recurring expense template
   */
  async createRecurringExpense(
    tenantId: string,
    buildingId: string,
    createDto: CreateRecurringExpenseDto,
  ): Promise<RecurringExpenseDto> {
    const nextRunDate = this.calculateNextRunDate(new Date(), createDto.frequency);

    const recurring = await this.prisma.recurringExpense.create({
      data: {
        tenantId,
        buildingId,
        categoryId: createDto.categoryId,
        amount: createDto.amount,
        currency: createDto.currency,
        concept: createDto.concept,
        frequency: createDto.frequency,
        nextRunDate,
        isActive: true,
      },
    });

    // Audit creation
    void this.auditService.createLog({
      tenantId,
      action: AuditAction.EXPENSE_CREATE,
      entityType: 'RecurringExpense',
      entityId: recurring.id,
      metadata: {
        frequency: createDto.frequency,
        amount: createDto.amount,
        concept: createDto.concept,
        nextRunDate: nextRunDate.toISOString(),
      },
    });

    return recurring as RecurringExpenseDto;
  }

  /**
   * List recurring expenses for a building
   */
  async listRecurringExpenses(
    tenantId: string,
    buildingId: string,
    includeInactive: boolean = false,
  ): Promise<RecurringExpenseDto[]> {
    return this.prisma.recurringExpense.findMany({
      where: {
        tenantId,
        buildingId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { nextRunDate: 'asc' },
    }) as Promise<RecurringExpenseDto[]>;
  }

  /**
   * Update a recurring expense template
   */
  async updateRecurringExpense(
    tenantId: string,
    recurringId: string,
    updateDto: UpdateRecurringExpenseDto,
  ): Promise<RecurringExpenseDto> {
    // Verify ownership
    const existing = await this.prisma.recurringExpense.findFirst({
      where: { id: recurringId, tenantId },
    });

    if (!existing) {
      throw new Error(`RecurringExpense not found: ${recurringId}`);
    }

    const updated = await this.prisma.recurringExpense.update({
      where: { id: recurringId },
      data: updateDto,
    });

    return updated as RecurringExpenseDto;
  }

  /**
   * [PHASE 4 HARD #14 CRONJOB] Process all due recurring expenses
   * Runs daily: creates DRAFT expenses for any recurring rules past nextRunDate
   */
  async processRecurringExpenses(): Promise<{ createdCount: number }> {
    const now = new Date();

    // Find all active recurring expenses due today or past
    const due = await this.prisma.recurringExpense.findMany({
      where: {
        isActive: true,
        nextRunDate: { lte: now },
      },
      include: {
        building: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
      },
    });

    let createdCount = 0;

    for (const recurring of due) {
      try {
        const period = this.getCurrentPeriod();

        // Create DRAFT expense
        await this.prisma.expense.create({
          data: {
            tenantId: recurring.tenantId,
            buildingId: recurring.buildingId,
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

        // Calculate next run date
        const nextRun = this.calculateNextRunDate(now, recurring.frequency);

        // Update nextRunDate
        await this.prisma.recurringExpense.update({
          where: { id: recurring.id },
          data: { nextRunDate: nextRun },
        });

        // Audit the creation (fire-and-forget)
        void this.auditService.createLog({
          tenantId: recurring.tenantId,
          action: AuditAction.EXPENSE_CREATE,
          entityType: 'Expense',
          entityId: recurring.id,
          metadata: {
            source: 'RECURRING_CRONJOB',
            recurringId: recurring.id,
            frequency: recurring.frequency,
            nextRunDate: nextRun.toISOString(),
          },
        });

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
   * Calculate next run date based on frequency
   */
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

  /**
   * Get current period in YYYY-MM format
   */
  private getCurrentPeriod(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }
}
