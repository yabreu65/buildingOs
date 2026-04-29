import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CommunicationsService } from '../../communications/communications.service';
import { FinanzasService } from '../../finanzas/finanzas.service';
import { TicketsService } from '../../tickets/tickets.service';
import { RecurringExpenseService } from '../../finanzas/recurring-expense.service';
import { FinanceSummaryService } from '../../finanzas/finance-summary.service';
import { SnapshotGenerationService } from '../../finanzas/snapshot-generation.service';

@Injectable()
export class CronJobsService {
  private readonly logger = new Logger(CronJobsService.name);
  private readonly maxRetries = 3;

  private isCronEnabled(flag: string, defaultValue: boolean = false): boolean {
    const value = process.env[flag];
    if (value == null) {
      return defaultValue;
    }

    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }

  private disabledResult(jobName: string) {
    this.logger.warn(`[CRON] Skipped: ${jobName} (disabled by env flag)`);
    return {
      success: true,
      data: { skipped: true },
      durationMs: 0,
    };
  }

  constructor(
    private communicationsService: CommunicationsService,
    private finanzasService: FinanzasService,
    private ticketsService: TicketsService,
    private recurringExpenseService: RecurringExpenseService,
    private financeSummaryService: FinanceSummaryService,
    private snapshotGenerationService: SnapshotGenerationService,
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
  ): Promise<{ success: boolean; data?: T; error?: string; durationMs: number }> {
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

  // =========================================================================
  // CRON JOBS (inherit this pattern for all future jobs)
  // =========================================================================

  /**
   * Every 5 minutes: Dispatch SCHEDULED communications
   * Fixes broken feature where scheduled comms never send
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async dispatchScheduledCommunications() {
    if (!this.isCronEnabled('ENABLE_CRON_SCHEDULED_COMMUNICATIONS', false)) {
      return this.disabledResult('dispatchScheduledCommunications');
    }

    return this.runWithErrorHandling('dispatchScheduledCommunications', async () => {
      const count = await this.communicationsService.dispatchScheduledCommunications();
      return { dispatchedCount: count };
    });
  }

  /**
   * [PHASE 3 MEDIUM #8] Daily at 9am: Detect overdue charges and notify residents
   */
  @Cron('0 9 * * *')
  async detectAndNotifyOverdueCharges() {
    if (!this.isCronEnabled('ENABLE_CRON_OVERDUE_CHARGES', false)) {
      return this.disabledResult('detectAndNotifyOverdueCharges');
    }

    return this.runWithErrorHandling('detectAndNotifyOverdueCharges', async () => {
      return await this.finanzasService.detectAndNotifyOverdueCharges();
    });
  }

  /**
   * [PHASE 3 MEDIUM #9] Monthly at 8am on 1st: Auto-create next month's expense period
   */
  @Cron('0 8 1 * *')
  async autoCreateMonthlyExpensePeriods() {
    if (!this.isCronEnabled('ENABLE_CRON_AUTO_EXPENSE_PERIODS', false)) {
      return this.disabledResult('autoCreateMonthlyExpensePeriods');
    }

    return this.runWithErrorHandling('autoCreateMonthlyExpensePeriods', async () => {
      return await this.finanzasService.autoCreateMonthlyExpensePeriods();
    });
  }

  /**
   * [PHASE 3 MEDIUM #10] Daily at 10am: Send payment reminders for charges due in 3 days
   */
  @Cron('0 10 * * *')
  async sendPaymentReminders() {
    if (!this.isCronEnabled('ENABLE_CRON_PAYMENT_REMINDERS', false)) {
      return this.disabledResult('sendPaymentReminders');
    }

    return this.runWithErrorHandling('sendPaymentReminders', async () => {
      return await this.finanzasService.sendPaymentReminders();
    });
  }

  /**
   * [PHASE 3 MEDIUM #12] Hourly: Escalate urgent unassigned tickets
   * Finds OPEN tickets that are HIGH/URGENT, unassigned, and waiting >2 hours
   * Notifies building admins and marks as escalated
   */
  @Cron('0 * * * *') // Every hour at :00
  async escalateUrgentTickets() {
    if (!this.isCronEnabled('ENABLE_CRON_TICKET_ESCALATION', false)) {
      return this.disabledResult('escalateUrgentTickets');
    }

    return this.runWithErrorHandling('escalateUrgentTickets', async () => {
      return await this.ticketsService.escalateUrgentTickets();
    });
  }

  /**
   * [PHASE 4 HARD #14] Daily at 6am: Process recurring expenses
   * Creates DRAFT expenses for all active recurring templates due today or past
   */
  @Cron('0 6 * * *')
  async processRecurringExpenses() {
    if (!this.isCronEnabled('ENABLE_CRON_RECURRING_EXPENSES', false)) {
      return this.disabledResult('processRecurringExpenses');
    }

    return this.runWithErrorHandling('processRecurringExpenses', async () => {
      return await this.recurringExpenseService.processRecurringExpenses();
    });
  }

  /**
   * [PHASE 4 HARD #15] Monthly on 1st at 1am: Send finance summaries
   * Generates and emails monthly finance reports to all TENANT_ADMIN members
   */
  @Cron('0 1 1 * *')
  async sendMonthlyFinanceSummaries() {
    if (!this.isCronEnabled('ENABLE_CRON_MONTHLY_FINANCE_SUMMARY', false)) {
      return this.disabledResult('sendMonthlyFinanceSummaries');
    }

    return this.runWithErrorHandling('sendMonthlyFinanceSummaries', async () => {
      return await this.financeSummaryService.sendMonthlyFinanceSummaries();
    });
  }

  /**
   * [P2-A] Monthly on 1st at 2am: Generate monthly snapshots
   * Creates snapshots for previous month (idempotent, per tenant)
   */
  @Cron('0 2 1 * *')
  async generateMonthlySnapshots() {
    if (!this.isCronEnabled('ENABLE_CRON_MONTHLY_SNAPSHOTS', false)) {
      return this.disabledResult('generateMonthlySnapshots');
    }

    return this.runWithErrorHandling('generateMonthlySnapshots', async () => {
      // Get all active tenants
      const tenants = await this.snapshotGenerationService.getAllActiveTenants();
      let totalUnitSnapshots = 0;
      let totalBuildingSnapshots = 0;

      for (const tenant of tenants) {
        const result = await this.snapshotGenerationService.generateSnapshotsForPreviousPeriod(
          tenant.id,
        );
        totalUnitSnapshots += result.unitSnapshotsCreated;
        totalBuildingSnapshots += result.buildingSnapshotsCreated;
      }

      return {
        tenantsProcessed: tenants.length,
        unitSnapshotsCreated: totalUnitSnapshots,
        buildingSnapshotsCreated: totalBuildingSnapshots,
      };
    });
  }
}
