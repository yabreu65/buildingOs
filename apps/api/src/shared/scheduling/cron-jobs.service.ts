import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CommunicationsService } from '../../communications/communications.service';
import { FinanzasService } from '../../finanzas/finanzas.service';
import { TicketsService } from '../../tickets/tickets.service';

@Injectable()
export class CronJobsService {
  private readonly logger = new Logger(CronJobsService.name);
  private readonly maxRetries = 3;

  constructor(
    private communicationsService: CommunicationsService,
    private finanzasService: FinanzasService,
    private ticketsService: TicketsService,
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
    return this.runWithErrorHandling('detectAndNotifyOverdueCharges', async () => {
      return await this.finanzasService.detectAndNotifyOverdueCharges();
    });
  }

  /**
   * [PHASE 3 MEDIUM #9] Monthly at 8am on 1st: Auto-create next month's expense period
   */
  @Cron('0 8 1 * *')
  async autoCreateMonthlyExpensePeriods() {
    return this.runWithErrorHandling('autoCreateMonthlyExpensePeriods', async () => {
      return await this.finanzasService.autoCreateMonthlyExpensePeriods();
    });
  }

  /**
   * [PHASE 3 MEDIUM #10] Daily at 10am: Send payment reminders for charges due in 3 days
   */
  @Cron('0 10 * * *')
  async sendPaymentReminders() {
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
    return this.runWithErrorHandling('escalateUrgentTickets', async () => {
      return await this.ticketsService.escalateUrgentTickets();
    });
  }

  // TODO: Add remaining 8 cron jobs here
  // Phase 4 (Hard): 3 features (import, recurring, email summaries)
  // Future phases: more automations and reporting
}
