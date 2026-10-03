import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CommunicationsService } from '../../communications/communications.service';
import { FinanzasService } from '../../finanzas/finanzas.service';
import { TicketsService } from '../../tickets/tickets.service';
import { RecurringExpenseService } from '../../finanzas/recurring-expense.service';
import { FinanceSummaryService } from '../../finanzas/finance-summary.service';
import { ReleaseAWriteBarrierService } from '../../tenancy/release-a-write-barrier.service';

interface CronJobResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly durationMs: number;
}

@Injectable()
export class CronJobsService {
  private readonly logger = new Logger(CronJobsService.name);
  constructor(
    private readonly communicationsService: CommunicationsService,
    private readonly finanzasService: FinanzasService,
    private readonly ticketsService: TicketsService,
    private readonly recurringExpenseService: RecurringExpenseService,
    private readonly financeSummaryService: FinanceSummaryService,
    private readonly writeBarrier: ReleaseAWriteBarrierService,
  ) {}

  /**
   * Safe wrapper for all cron jobs
   * - Logs start/end/duration
   * - Catches errors without failing (fire-and-forget pattern)
   * - Returns success count or error details
   */
  private async runWithErrorHandling<T>(
    jobName: string,
    fn: () => Promise<T>,
  ): Promise<CronJobResult<T>> {
    const startTime = Date.now();
    try {
      this.logger.log(`[CRON] Starting: ${jobName}`);
      const result = await fn();
      const durationMs = Date.now() - startTime;
      this.logger.log(`[CRON] Completed: ${jobName} in ${durationMs}ms`);
      return { success: true, data: result, durationMs };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[CRON] Failed: ${jobName} after ${durationMs}ms — ${errorMsg}`,
        error instanceof Error ? error.stack : '',
      );
      // Fire-and-forget: log but don't throw
      return { success: false, error: errorMsg, durationMs };
    }
  }

  private isWriteAllowed(): boolean {
    try {
      return this.writeBarrier.isOpen();
    } catch {
      return false;
    }
  }

  private readonly writeAllowed = (): boolean => this.isWriteAllowed();

  // =========================================================================
  // CRON JOBS (inherit this pattern for all future jobs)
  // =========================================================================

  /**
   * Every 5 minutes: Dispatch SCHEDULED communications
   * Fixes broken feature where scheduled comms never send
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async dispatchScheduledCommunications(): Promise<CronJobResult<{ dispatchedCount: number }>> {
    if (!this.isWriteAllowed()) return { success: true, durationMs: 0 };
    return this.runWithErrorHandling('dispatchScheduledCommunications', async () => {
      const count = await this.communicationsService.dispatchScheduledCommunications(this.writeAllowed);
      return { dispatchedCount: count };
    });
  }

  /**
   * [PHASE 3 MEDIUM #9] Monthly at 8am on 1st: Auto-create next month's expense period
   */
  @Cron('0 8 1 * *')
  async autoCreateMonthlyExpensePeriods(): Promise<CronJobResult<{ created: number }>> {
    if (!this.isWriteAllowed()) return { success: true, durationMs: 0 };
    return this.runWithErrorHandling('autoCreateMonthlyExpensePeriods', async () => {
      return await this.finanzasService.autoCreateMonthlyExpensePeriods(this.writeAllowed);
    });
  }

  /**
   * [PHASE 3 MEDIUM #10] Daily at 10am: Send payment reminders for charges due in 3 days
   */
  @Cron('0 10 * * *')
  async sendPaymentReminders(): Promise<CronJobResult<{ count: number }>> {
    if (!this.isWriteAllowed()) return { success: true, durationMs: 0 };
    return this.runWithErrorHandling('sendPaymentReminders', async () => {
      return await this.finanzasService.sendPaymentReminders(this.writeAllowed);
    });
  }

  /**
   * [PHASE 3 MEDIUM #12] Hourly: Escalate urgent unassigned tickets
   * Finds OPEN tickets that are HIGH/URGENT, unassigned, and waiting >2 hours
   * Notifies building admins and marks as escalated
   */
  @Cron('0 * * * *') // Every hour at :00
  async escalateUrgentTickets(): Promise<CronJobResult<{ escalatedCount: number }>> {
    if (!this.isWriteAllowed()) return { success: true, durationMs: 0 };
    return this.runWithErrorHandling('escalateUrgentTickets', async () => {
      return await this.ticketsService.escalateUrgentTickets(this.writeAllowed);
    });
  }

  /**
   * [PHASE 4 HARD #14] Daily at 6am: Process recurring expenses
   * Creates DRAFT expenses for all active recurring templates due today or past
   */
  @Cron('0 6 * * *')
  async processRecurringExpenses(): Promise<CronJobResult<{ createdCount: number }>> {
    if (!this.isWriteAllowed()) return { success: true, durationMs: 0 };
    return this.runWithErrorHandling('processRecurringExpenses', async () => {
      return await this.recurringExpenseService.processRecurringExpenses(this.writeAllowed);
    });
  }

  /**
   * [PHASE 4 HARD #15] Monthly on 1st at 1am: Send finance summaries
   * Generates and emails monthly finance reports to all TENANT_ADMIN members
   */
  @Cron('0 1 1 * *')
  async sendMonthlyFinanceSummaries(): Promise<CronJobResult<{ sentCount: number }>> {
    if (!this.isWriteAllowed()) return { success: true, durationMs: 0 };
    return this.runWithErrorHandling('sendMonthlyFinanceSummaries', async () => {
      return await this.financeSummaryService.sendMonthlyFinanceSummaries(this.writeAllowed);
    });
  }
}
