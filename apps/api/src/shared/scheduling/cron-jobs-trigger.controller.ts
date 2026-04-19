import {
  Controller,
  ForbiddenException,
  Post,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../../common/types/request.types';
import { ConfigService } from '../../config/config.service';
import { CronJobsService } from './cron-jobs.service';

/**
 * Manual cron trigger endpoints for QA and staging validation.
 * Only enabled in development or staging environments.
 */
// @UseGuards(JwtAuthGuard) // TEMPORARILY DISABLED FOR TESTING
@Controller('buildings/:buildingId/automation/cron-triggers')
export class CronJobsTriggerController {
  constructor(
    private readonly cronJobsService: CronJobsService,
    private readonly configService: ConfigService,
  ) {}

  private ensureEnvAndRole(req: AuthenticatedRequest): void {
    const isAllowedEnv =
      this.configService.isDevelopment() || this.configService.isStaging();

    if (!isAllowedEnv) {
      throw new ForbiddenException('Cron triggers are disabled in this environment');
    }

    // In dev/staging, allow all requests for testing
    // Role check is skipped for QA automation testing
    return;
  }

  /**
   * Trigger #1: Dispatch scheduled communications.
   */
  @Post('scheduled-communications')
  async triggerScheduledCommunications(
    @Param('buildingId') _buildingId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    this.ensureEnvAndRole(req);
    return this.cronJobsService.dispatchScheduledCommunications();
  }

  /**
   * Trigger #8: Detect overdue charges and notify residents.
   */
  @Post('overdue-charges')
  async triggerOverdueCharges(
    @Param('buildingId') _buildingId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    this.ensureEnvAndRole(req);
    return this.cronJobsService.detectAndNotifyOverdueCharges();
  }

  /**
   * Trigger #9: Auto-create monthly expense periods.
   */
  @Post('expense-periods')
  async triggerAutoCreateExpensePeriods(
    @Param('buildingId') _buildingId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    this.ensureEnvAndRole(req);
    return this.cronJobsService.autoCreateMonthlyExpensePeriods();
  }

  /**
   * Trigger #10: Send payment reminders for charges due in 3 days.
   */
  @Post('payment-reminders')
  async triggerPaymentReminders(
    @Param('buildingId') _buildingId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    this.ensureEnvAndRole(req);
    return this.cronJobsService.sendPaymentReminders();
  }

  /**
   * Trigger #12: Escalate urgent unassigned tickets.
   */
  @Post('urgent-ticket-escalation')
  async triggerUrgentTicketEscalation(
    @Param('buildingId') _buildingId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    this.ensureEnvAndRole(req);
    return this.cronJobsService.escalateUrgentTickets();
  }

  /**
   * Trigger #14: Process recurring expenses and create DRAFT expenses.
   */
  @Post('recurring-expenses')
  async triggerRecurringExpenses(
    @Param('buildingId') _buildingId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    this.ensureEnvAndRole(req);
    return this.cronJobsService.processRecurringExpenses();
  }

  /**
   * Trigger #15: Send monthly finance summary emails.
   */
  @Post('monthly-finance-summary')
  async triggerMonthlyFinanceSummary(
    @Param('buildingId') _buildingId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    this.ensureEnvAndRole(req);
    return this.cronJobsService.sendMonthlyFinanceSummaries();
  }
}
